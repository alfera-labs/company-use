import { runtime_tool_result_to_agent_tool_result } from '@agent-core/engines/pi/pi_tools';
import type { SessionEnv } from '@agent-core/environment/session_env';
import type { RuntimeRunEvent } from '@agent-core/events/runtime_event';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import { create_app } from '@api/app';
import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_run_message,
  create_session,
  get_tool_call,
  set_tool_call_output,
  update_run_status,
} from '@coworker/core/db/queries/sessions';
import { run_events, tool_calls } from '@coworker/core/db/schema';
import {
  type ChatStreamEventDraft,
  create_in_memory_object_storage,
  create_logged_tool_definition,
  create_persisted_tool_result_message,
  create_runtime_tool_definitions,
  execute_runtime_tool,
  project_runtime_event_to_chat_event_drafts,
  record_chat_stream_event_drafts,
  record_runtime_event,
  seed_native_catalogs,
  set_memory_import_object_storage_for_tests,
  stringify_tool_result,
} from '@coworker/runtime-platform';
import { cap_strings_in_tool_payload, order_keys_like_jsonb } from '@coworker/shared';
import {
  platform_result_to_model_tool_result,
  platform_tool_result_to_runtime_tool_result,
} from '@runtime-platform/tools/stored_tool_result_shape';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('stored tool results on the read routes', () => {
  it('serves identical messages, chat events, tool calls, and run events for v1 and v2 rows', async () => {
    const fixture = await write_v2_run();
    await expect_rows_stored_as_v2(fixture);
    const v2_bytes = await engine_end_event_bytes(fixture);
    const v2 = await read_routes(fixture);

    await rewrite_as_v1(fixture);
    const v1 = await read_routes(fixture);
    const v1_bytes = await engine_end_event_bytes(fixture);

    expect(v2_bytes).toBeLessThan(v1_bytes);
    expect(long_engine_text_in_jsonb_order(v2.inspect)).toBe(
      long_engine_text_in_jsonb_order(v1.inspect),
    );
    expect(sse_long_engine_text_in_jsonb_order(v2.live_run_events)).toBe(
      sse_long_engine_text_in_jsonb_order(v1.live_run_events),
    );

    expect(v2.messages).toBe(v1.messages);
    expect(v2.tool_calls).toBe(v1.tool_calls);
    expect(without_long_engine_text(v2.chat_events)).toBe(without_long_engine_text(v1.chat_events));
    expect(long_engine_text(v2.chat_events)).toEqual(long_engine_text(v1.chat_events));
    expect(without_long_engine_text(v2.run_events)).toBe(without_long_engine_text(v1.run_events));
  });
});

describe('a command result with a large stdout on the read routes', () => {
  afterEach(() => set_memory_import_object_storage_for_tests(undefined));

  it('stores the stdout once, serves it whole on the full reads, and keeps old rows the same', async () => {
    set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
    const stdout = long_stdout(60_000);
    const { db, ids, tool_call_id, result } = await write_run_command_run(stdout);
    const [row] = await db
      .select({ bytes: sql<number>`octet_length(${tool_calls.output_data}::text)::int` })
      .from(tool_calls)
      .where(eq(tool_calls.tool_call_id, tool_call_id));
    expect(Number(row?.bytes)).toBeLessThan(36_000);

    const app = create_app(db);
    const read = async (path: string) => {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      return response.text();
    };
    const message_id = await tool_result_message_id(db, ids);
    const v2 = {
      tool_call: await read(`/v1/tool-calls/${tool_call_id}`),
      message: await read(`/v1/sessions/${ids.session_id}/messages/${message_id}`),
      page: await read(`/v1/sessions/${ids.session_id}/messages`),
    };

    const tool_call = JSON.parse(v2.tool_call).data;
    expect(tool_call.output_data.metadata.command_result.stdout).toBe(stdout);
    const message = JSON.parse(v2.message).data;
    const content = message.message_content;
    expect(content.parts[0].result.metadata.command_result.stdout).toBe(stdout);
    expect(content.data).toEqual({
      tool_call_id,
      model_tool_call_id: 'model_cat',
      tool_name: 'workspace-run_command',
    });
    const middle_line = '1500,customer 1500,';
    expect(stdout).toContain(middle_line);
    expect(v2.message.split(middle_line)).toHaveLength(2);
    expect(v2.page).not.toContain(middle_line);

    await rewrite_run_command_as_inline(db, ids, tool_call_id, result);
    const inline = {
      tool_call: await read(`/v1/tool-calls/${tool_call_id}`),
      message: await read(`/v1/sessions/${ids.session_id}/messages/${message_id}`),
    };
    expect(JSON.parse(inline.message).data.message_content).not.toHaveProperty('shape');
    expect(without_update_time(inline.tool_call)).toBe(without_update_time(v2.tool_call));
    expect(without_update_time(inline.message)).toBe(without_update_time(v2.message));
  });
});

function long_stdout(characters: number) {
  const lines: string[] = ['order_id,customer,amount'];
  for (let index = 0; lines.join('\n').length < characters; index += 1) {
    lines.push(`${index},customer ${index},${(index * 7.31).toFixed(2)}`);
  }
  return lines.join('\n').slice(0, characters);
}

async function write_run_command_run(stdout: string) {
  const db = await create_test_database();
  await seed_native_catalogs(db);
  const actor = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    actor_id: actor.user_id,
  });
  const run = await create_run(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    agent_id: actor.agent_id,
    trigger_type: 'user_message',
    actor_id: actor.user_id,
  });
  const ids: RunIds = {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    actor_id: actor.user_id,
  };
  const files = new Map<string, string>();
  const environment: SessionEnv = {
    env_key: 'sandbox_1',
    env_kind: 'remote_sandbox',
    exec: async () => ({ exit_code: 0, stdout, stderr: '' }),
    write: async (path, contents) => {
      files.set(path, contents);
    },
    read: async (path) => files.get(path) ?? '',
  };
  const tool = create_runtime_tool_definitions(db, { ...ids, environment }).find(
    (definition) => definition.tool_name === 'workspace-run_command',
  );
  const result = await tool?.execute?.(
    { command: 'cat', args: ['orders.csv'] },
    { run_key: run.run_id, tool_call_id: 'model_cat', metadata: {}, environment },
  );
  if (!result?.ok) throw new Error('The command failed');
  const { tool_call_id, ...metadata } = result.metadata ?? {};
  return { db, ids, tool_call_id: String(tool_call_id), result: { ...result, metadata } };
}

function without_update_time(body: string) {
  return body.replace(/"last_updated_time":"[^"]+"/u, '"last_updated_time":"(rewritten)"');
}

async function tool_result_message_id(db: Database, ids: RunIds) {
  const { list_run_messages } = await import('@coworker/core/db/queries/sessions');
  const messages = await list_run_messages(db, ids.workspace_id, ids.run_id);
  const message = messages.find((candidate) => candidate.message_role === 'tool_result');
  if (!message) throw new Error('No tool_result message was written');
  return message.run_message_id;
}

async function rewrite_run_command_as_inline(
  db: Database,
  ids: RunIds,
  tool_call_id: string,
  result: RuntimeToolResult,
) {
  const call = await get_tool_call(db, ids.workspace_id, tool_call_id);
  await set_tool_call_output(db, {
    tool_call_id,
    output_data: result,
    output_text: call?.output_text ?? null,
    output_file_id: call?.output_file_id ?? null,
    actor_id: ids.actor_id,
  });
  await create_persisted_tool_result_message(db, {
    ...ids,
    tool_call_id,
    model_tool_call_id: 'model_cat',
    tool_name: 'workspace-run_command',
    result,
    result_is_stored_on_tool_call: false,
  });
}

type Fixture = Awaited<ReturnType<typeof write_v2_run>>;
type RunIds = { workspace_id: string; session_id: string; run_id: string; actor_id: string };

async function write_v2_run() {
  const db = await create_test_database();
  await seed_native_catalogs(db);
  const actor = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    actor_id: actor.user_id,
  });
  const run = await create_run(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    agent_id: actor.agent_id,
    trigger_type: 'user_message',
    actor_id: actor.user_id,
  });
  const ids: RunIds = {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    actor_id: actor.user_id,
  };
  const drafts_by_event_id = new Map<string, ChatStreamEventDraft>();
  const record = async (drafts: ChatStreamEventDraft[]) => {
    const events = await record_chat_stream_event_drafts(db, { ...ids, drafts });
    events.forEach((event, index) => {
      const draft = drafts[index];
      if (draft) drafts_by_event_id.set(event.event_id, draft);
    });
  };

  await create_run_message(db, {
    ...ids,
    message_role: 'user',
    message_content: { type: 'text', text: 'Add two and two, then echo a report.' },
    source_type: 'dashboard',
  });
  await assistant_tool_calls(db, ids);

  await record_engine_event(
    db,
    ids,
    record,
    'pi.tool_execution_start',
    'model_math',
    'math-calculate-1',
    {
      args: { expression: '2 + 2' },
    },
  );
  const math = await execute_runtime_tool(db, {
    ...ids,
    model_tool_call_id: 'model_math',
    node_key: 'math-calculate-1',
    tool_input: { expression: '2 + 2' },
    emit_chat_stream_event_drafts: record,
  });
  const math_model_result = platform_result_to_model_tool_result(math.result);
  const math_end = await record_engine_event(
    db,
    ids,
    record,
    'pi.tool_execution_end',
    'model_math',
    'math-calculate-1',
    {
      result: runtime_tool_result_to_agent_tool_result(math_model_result, {
        tool_call_id: 'model_math',
        tool_name: 'math-calculate-1',
      }),
      is_error: false,
    },
  );

  await record_engine_event(
    db,
    ids,
    record,
    'pi.tool_execution_start',
    'model_echo',
    'workspace-echo',
    {
      args: { topic: 'report' },
    },
  );
  const echo = await echo_tool(db, ids, record).execute?.(
    { topic: 'report' },
    {
      run_key: run.run_id,
      session_key: session.session_id,
      tool_call_id: 'model_echo',
      metadata: {},
    },
  );
  if (!echo?.ok) throw new Error('The echo tool failed');
  const { metadata: _metadata, ...echo_model_result } = echo;
  const echo_end = await record_engine_event(
    db,
    ids,
    record,
    'pi.tool_execution_end',
    'model_echo',
    'workspace-echo',
    {
      result: runtime_tool_result_to_agent_tool_result(echo_model_result as RuntimeToolResult, {
        tool_call_id: 'model_echo',
        tool_name: 'workspace-echo',
      }),
      is_error: false,
    },
  );
  await update_run_status(db, {
    run_id: run.run_id,
    run_status: 'completed',
    actor_id: ids.actor_id,
  });

  return {
    db,
    ids,
    drafts_by_event_id,
    engine_end_metadata: [math_end, echo_end],
    math: { tool_call_id: math.tool_call.tool_call_id, result: math.result },
    echo: { tool_call_id: String(echo.metadata?.tool_call_id) },
  };
}

async function rewrite_as_v1(fixture: Fixture) {
  const { db, ids } = fixture;
  await set_tool_call_output(db, {
    tool_call_id: fixture.math.tool_call_id,
    output_data: fixture.math.result,
    output_text: stringify_tool_result(fixture.math.result),
    output_file_id: null,
    actor_id: ids.actor_id,
  });
  await set_tool_call_output(db, {
    tool_call_id: fixture.echo.tool_call_id,
    output_data: echo_result,
    output_text: echo_result.ok ? (echo_result.content_text ?? '') : '',
    output_file_id: null,
    actor_id: ids.actor_id,
  });
  await create_persisted_tool_result_message(db, {
    ...ids,
    tool_call_id: fixture.math.tool_call_id,
    model_tool_call_id: 'model_math',
    tool_name: 'math-calculate-1',
    result: platform_tool_result_to_runtime_tool_result(fixture.math.result),
    result_is_stored_on_tool_call: false,
  });
  await create_persisted_tool_result_message(db, {
    ...ids,
    tool_call_id: fixture.echo.tool_call_id,
    model_tool_call_id: 'model_echo',
    tool_name: 'workspace-echo',
    result: echo_result,
    result_is_stored_on_tool_call: false,
  });
  for (const [run_event_id, draft] of fixture.drafts_by_event_id) {
    await db
      .update(run_events)
      .set({ event_data: cap_strings_in_tool_payload(draft) })
      .where(eq(run_events.run_event_id, run_event_id));
  }
  for (const metadata of fixture.engine_end_metadata) {
    await db
      .update(run_events)
      .set({ event_metadata: metadata })
      .where(
        and(
          eq(run_events.run_id, ids.run_id),
          eq(run_events.event_label, 'pi.tool_execution_end'),
          sql`${run_events.event_metadata} ->> 'tool_call_id' = ${String(metadata.tool_call_id)}`,
        ),
      );
  }
}

async function engine_end_event_bytes(fixture: Fixture) {
  const [row] = await fixture.db
    .select({ bytes: sql<number>`sum(octet_length(${run_events.event_metadata}::text))::int` })
    .from(run_events)
    .where(
      and(
        eq(run_events.run_id, fixture.ids.run_id),
        eq(run_events.event_label, 'pi.tool_execution_end'),
      ),
    );
  return Number(row?.bytes);
}

async function expect_rows_stored_as_v2(fixture: Fixture) {
  const { list_run_events, list_run_messages, list_run_tool_calls } = await import(
    '@coworker/core/db/queries/sessions'
  );
  const { workspace_id, run_id } = fixture.ids;
  const messages = await list_run_messages(fixture.db, workspace_id, run_id);
  const results = messages.filter((message) => message.message_role === 'tool_result');
  expect(results.map((message) => (message.message_content as { shape?: string }).shape)).toEqual([
    'run_message_v2',
    'run_message_v2',
  ]);
  const calls = await list_run_tool_calls(fixture.db, workspace_id, run_id);
  expect(calls.map((call) => (call.output_data as { shape?: string }).shape)).toEqual([
    'tool_result_v2',
    'tool_result_v2',
  ]);
  const items = (await list_run_events(fixture.db, workspace_id, run_id)).flatMap((event) => {
    const item = (event.event_data as { item?: Record<string, unknown> }).item;
    return event.event_type === 'chat_event' && item?.item_type === 'tool_call' ? [item] : [];
  });
  expect(items).toHaveLength(8);
  for (const item of items) {
    expect(item.stored_output).toBeDefined();
    expect(item).not.toHaveProperty('output_data');
    expect(item).not.toHaveProperty('input_data');
  }
  const engine_ends = (await list_run_events(fixture.db, workspace_id, run_id)).filter(
    (event) => event.event_label === 'pi.tool_execution_end',
  );
  expect(engine_ends).toHaveLength(2);
  for (const event of engine_ends) {
    expect(event.event_metadata).toMatchObject({
      shape: 'runtime_tool_event_v2',
      tool_call_id: expect.any(String),
      tool_name: expect.any(String),
      is_error: false,
      result_preview: expect.any(String),
    });
    expect(event.event_metadata).not.toHaveProperty('result');
    const metadata = event.event_metadata as { result_preview?: unknown };
    expect(String(metadata.result_preview).length).toBeLessThanOrEqual(1_024);
  }
}

async function read_routes(fixture: Fixture) {
  const app = create_app(fixture.db);
  const read = async (path: string) => {
    const response = await app.request(path);
    expect(response.status).toBe(200);
    return response.text();
  };
  return {
    messages: await read(`/v1/sessions/${fixture.ids.session_id}/messages`),
    tool_calls: await read(`/v1/runs/${fixture.ids.run_id}/tool-calls`),
    chat_events: await read(`/v1/runs/${fixture.ids.run_id}/chat-stream-events`),
    run_events: await read(`/v1/runs/${fixture.ids.run_id}/events`),
    inspect: await read(`/v1/runs/${fixture.ids.run_id}/inspect`),
    live_run_events: await read_live_stream(app, fixture.ids.run_id),
  };
}

async function read_live_stream(app: ReturnType<typeof create_app>, run_id: string) {
  const response = await app.request(`/v1/runs/${run_id}/events`, {
    headers: { accept: 'text/event-stream' },
  });
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain('pi.tool_execution_end');
  return body;
}

const echo_result: RuntimeToolResult = {
  ok: true,
  content_text: `Report: ${'all systems nominal. '.repeat(150)}`,
  content_json: { topic: 'report', lines: 150 },
};

function echo_tool(
  db: Database,
  ids: RunIds,
  record: (drafts: ChatStreamEventDraft[]) => Promise<void>,
) {
  return create_logged_tool_definition(
    db,
    { ...ids, emit_chat_stream_event_drafts: record },
    {
      tool_name: 'workspace-echo',
      description: 'Echoes a report.',
      execute: async () => echo_result,
    },
    {
      timeout_ms: 5_000,
      output_limit_bytes: 16_000,
      risk_class: 'read',
      approval_mode: 'auto',
      sandbox_required: false,
    },
  );
}

async function assistant_tool_calls(db: Database, ids: RunIds) {
  await create_run_message(db, {
    ...ids,
    message_role: 'assistant',
    message_content: {
      type: 'multimodal',
      parts: [
        {
          type: 'tool_call',
          id: 'model_math',
          name: 'math-calculate-1',
          arguments: { expression: '2 + 2' },
        },
        {
          type: 'tool_call',
          id: 'model_echo',
          name: 'workspace-echo',
          arguments: { topic: 'report' },
        },
      ],
    },
    source_type: 'runtime',
  });
}

let next_event_sequence = 1;

async function record_engine_event(
  db: Database,
  ids: RunIds,
  record: (drafts: ChatStreamEventDraft[]) => Promise<void>,
  label: string,
  tool_call_id: string,
  tool_name: string,
  metadata: Record<string, unknown>,
) {
  const event_metadata = { tool_call_id, tool_name, ...metadata };
  const event: RuntimeRunEvent = {
    event_id: `engine_event_${next_event_sequence}`,
    event_sequence: next_event_sequence++,
    run_key: ids.run_id,
    event_type: 'progress',
    label,
    metadata: event_metadata,
  };
  await record_runtime_event(db, { ...ids, event });
  await record(project_runtime_event_to_chat_event_drafts({ ...ids, event }));
  return event_metadata;
}

const wire_event_schema = z.object({
  event_type: z.string().optional(),
  item: z
    .object({ tool_call_id: z.string().nullish(), output_text: z.string().nullish() })
    .nullish(),
});
const wire_body_schema = z.object({
  data: z.array(wire_event_schema.extend({ event_data: wire_event_schema.nullish() })),
});
type WireEvent = z.infer<typeof wire_event_schema>;

function is_long_engine_item(event: WireEvent) {
  return (
    event.event_type === 'item_completed' &&
    event.item?.tool_call_id === 'model_echo' &&
    (event.item.output_text?.length ?? 0) > 1_024
  );
}

function read_events(body: string) {
  const events = wire_body_schema.parse(JSON.parse(body)).data;
  return events.map((event) => event.event_data ?? event);
}

function without_long_engine_text(body: string) {
  return JSON.stringify(change_long_engine_text(JSON.parse(body), () => '[compared parsed]'));
}

function long_engine_text(body: string) {
  const texts = read_events(body).flatMap((event) =>
    is_long_engine_item(event) ? [JSON.parse(String(event.item?.output_text))] : [],
  );
  expect(texts).toHaveLength(1);
  return texts;
}

function long_engine_text_in_jsonb_order(body: string) {
  return JSON.stringify(
    change_long_engine_text(JSON.parse(body), (text) =>
      JSON.stringify(order_keys_like_jsonb(JSON.parse(text))),
    ),
  );
}

function sse_long_engine_text_in_jsonb_order(body: string) {
  return body
    .split('\n')
    .map((line) =>
      line.startsWith('data: ') ? `data: ${long_engine_text_in_jsonb_order(line.slice(6))}` : line,
    )
    .join('\n');
}

function change_long_engine_text(value: unknown, change: (text: string) => string): unknown {
  if (Array.isArray(value)) return value.map((nested) => change_long_engine_text(nested, change));
  if (value === null || typeof value !== 'object') return value;
  const record = value as WireEvent;
  if (is_long_engine_item(record) && record.item) {
    const text = change(String(record.item.output_text));
    return { ...record, item: { ...record.item, output_text: text } };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, change_long_engine_text(nested, change)]),
  );
}
