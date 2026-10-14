import type { SessionEnv } from '@agent-core/environment/session_env';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_file, list_run_files } from '@coworker/core/db/queries/files';
import {
  create_run,
  create_run_message,
  create_session,
  create_tool_call_started,
  get_tool_call,
  list_run_events,
  list_run_messages,
  list_session_messages,
} from '@coworker/core/db/queries/sessions';
import type { MessageContent } from '@coworker/shared';
import { create_chat_stream_event_recorder } from '@runtime-platform/chat_stream/chat_stream_snapshots';
import { create_in_memory_object_storage } from '@runtime-platform/files/in_memory_object_storage';
import {
  type ObjectStorage,
  set_memory_import_object_storage_for_tests,
} from '@runtime-platform/files/object_storage';
import { load_stored_value } from '@runtime-platform/files/stored_body';
import { build_session_context } from '@runtime-platform/orchestrator/context_builder';
import {
  message_content_to_runtime_parts,
  runtime_message_parts_text,
} from '@runtime-platform/orchestrator/runtime_message_content';
import {
  type HarnessRunMessage,
  project_run_messages_to_pi_session_entries,
} from '@runtime-platform/session_harness/session_entries';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import {
  type LargeValueReading,
  store_tool_call_output,
} from '@runtime-platform/tools/stored_tool_result';
import {
  restore_run_message_tool_results,
  restore_tool_call_outputs,
} from '@runtime-platform/tools/stored_tool_result_reads';
import { tool_result_v2_from_runtime_result } from '@runtime-platform/tools/stored_tool_result_shape';
import {
  create_logged_tool_definition,
  create_persisted_tool_result_message,
  create_runtime_tool_definitions,
  execute_runtime_tool,
} from '@runtime-platform/tools/tool_execution_service';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  set_memory_import_object_storage_for_tests(undefined);
  vi.restoreAllMocks();
});

describe('a tool result stored once', () => {
  it('writes a catalog result once: v2 on the call, a pointer message, slim chat events', async () => {
    const fixture = await create_fixture();
    const record_chat_events = create_chat_stream_event_recorder(fixture.db, fixture.ids);

    const execution = await execute_runtime_tool(fixture.db, {
      ...fixture.ids,
      model_tool_call_id: 'model_call_1',
      node_key: 'math-calculate-1',
      tool_input: { expression: '2 + 2' },
      emit_chat_stream_event_drafts: async (drafts) => {
        await record_chat_events(drafts);
      },
    });

    expect(execution.result.success).toBe(true);
    expect(execution.tool_call.output_data).toMatchObject({ success: true });
    const call = await get_tool_call(
      fixture.db,
      fixture.ids.workspace_id,
      execution.tool_call.tool_call_id,
    );
    expect(call?.output_data).toMatchObject({
      shape: 'tool_result_v2',
      result_format: 'platform_tool_result',
      ok: true,
      content_text: expect.any(String),
    });

    const [message] = await tool_result_rows(fixture);
    expect(message?.message_content).toEqual({
      shape: 'run_message_v2',
      parts: [{ type: 'tool_result', tool_call_id: execution.tool_call.tool_call_id }],
    });
    expect(message?.content_json).toBeNull();
    expect(message?.content_text).toBe(
      String(
        call?.output_data && (call.output_data as { content_text: string }).content_text,
      ).slice(0, 1024),
    );
    expect(message?.token_count).toBeGreaterThan(0);

    const tool_items = await stored_tool_items(fixture);
    expect(tool_items.length).toBeGreaterThanOrEqual(2);
    for (const item of tool_items) {
      expect(item).not.toHaveProperty('output_data');
      expect(item).not.toHaveProperty('input_data');
      expect(item.stored_output).toMatchObject({ shape: 'chat_tool_item_v2' });
      expect(String(item.output_text ?? '').length).toBeLessThanOrEqual(1024);
    }
  });

  it('moves a content_json over 32 KB to object storage behind an artifact_ref', async () => {
    const storage = create_in_memory_object_storage();
    set_memory_import_object_storage_for_tests(storage);
    const fixture = await create_fixture();
    const big_value = {
      rows: Array.from({ length: 800 }, (_, index) => ({ index, note: 'x'.repeat(48) })),
    };

    const result = await echo_tool(fixture, {
      ok: true,
      content_text: 'listed 800 rows',
      content_json: big_value,
    });

    expect(result?.ok).toBe(true);
    const tool_call_id = String(result?.metadata?.tool_call_id);
    const call = await get_tool_call(fixture.db, fixture.ids.workspace_id, tool_call_id);
    const stored = call?.output_data as { content_json: { artifact_ref: Record<string, unknown> } };
    const artifact_ref = stored.content_json.artifact_ref;
    expect(artifact_ref).toEqual({
      artifact_id: expect.any(String),
      byte_size: Buffer.byteLength(JSON.stringify(big_value)),
      preview: JSON.stringify(big_value).slice(0, 500),
    });
    expect(call?.output_file_id).toBe(artifact_ref.artifact_id);

    const artifact = await fixture.db.query.files.findFirst({
      where: (table, { eq }) => eq(table.file_id, String(artifact_ref.artifact_id)),
    });
    expect(artifact).toMatchObject({
      file_purpose: 'stored_tool_result',
      storage_provider: 'object_store',
      storage_key: `ws/${fixture.ids.workspace_id}/sha256/${artifact?.checksum_sha256}`,
      byte_size: artifact_ref.byte_size,
      is_visible: false,
      source_tool_call_id: tool_call_id,
      run_id: fixture.ids.run_id,
      session_id: fixture.ids.session_id,
    });
    expect(storage.objects.has(String(artifact?.storage_key))).toBe(true);
    await expect(
      load_stored_value(fixture.db, {
        workspace_id: fixture.ids.workspace_id,
        artifact_id: String(artifact_ref.artifact_id),
      }),
    ).resolves.toEqual(big_value);
  });

  it('keeps a large value inline and finishes the call when object storage refuses it', async () => {
    const storage: ObjectStorage = {
      ...create_in_memory_object_storage(),
      put_if_absent: async () => {
        throw new Error('bucket unreachable');
      },
    };
    set_memory_import_object_storage_for_tests(storage);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = await create_fixture();
    const big_value = { blob: 'y'.repeat(40_000) };

    const result = await echo_tool(fixture, {
      ok: true,
      content_text: 'made a blob',
      content_json: big_value,
    });

    expect(result?.ok).toBe(true);
    const call = await get_tool_call(
      fixture.db,
      fixture.ids.workspace_id,
      String(result?.metadata?.tool_call_id),
    );
    expect(call?.tool_status).toBe('completed');
    expect(call?.output_data).toMatchObject({ shape: 'tool_result_v2', content_json: big_value });
    expect(call?.output_file_id).toBeNull();
  });

  it('keeps a large value inline when object storage is not configured', async () => {
    const fixture = await create_fixture();
    const big_value = { blob: 'z'.repeat(40_000) };

    const result = await echo_tool(fixture, {
      ok: true,
      content_text: 'made a blob',
      content_json: big_value,
    });

    const call = await get_tool_call(
      fixture.db,
      fixture.ids.workspace_id,
      String(result?.metadata?.tool_call_id),
    );
    expect(call?.output_data).toMatchObject({ shape: 'tool_result_v2', content_json: big_value });
  });
});

describe('model replay of stored tool results', () => {
  it('projects the same pi session entries from v1 rows and from v2 rows', async () => {
    set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
    const db = await create_test_database();
    const actor = await bootstrap_default_workspace(db);
    const v1 = await write_replay_session(db, actor, 'inline');
    const v2 = await write_replay_session(db, actor, 'stored_on_tool_call');

    const v2_rows = await list_session_messages(db, actor.workspace_id, v2.session_id);
    expect(v2_rows.filter((row) => 'shape' in row.message_content)).toHaveLength(results.length);
    expect(await count_artifacts(db, v2.session_id)).toBe(2);

    const v1_entries = await replay_entries(db, actor.workspace_id, v1.session_id);
    const v2_entries = await replay_entries(db, actor.workspace_id, v2.session_id);
    expect(v2_entries).toEqual(v1_entries);
    expect(JSON.stringify(v2_entries)).toBe(JSON.stringify(v1_entries));

    const v2_model_entries = await replay_entries(
      db,
      actor.workspace_id,
      v2.session_id,
      'load_model_visible_value',
    );
    expect(v2_model_entries.map(model_visible_content)).toEqual(
      v1_entries.map(model_visible_content),
    );
  });
});

describe('model context reads only the stored bodies the model sees', () => {
  it('reads no body when every stored result has content_text', async () => {
    const storage = counted_object_storage();
    const db = await create_test_database();
    const actor = await bootstrap_default_workspace(db);
    const texts = ['first', 'second', 'third'];
    const session = await write_replay_session(
      db,
      actor,
      'stored_on_tool_call',
      texts.map((text) => ({
        tool_name: 'workspace-list',
        result: { ok: true, content_text: `listed ${text}`, content_json: large_json(text) },
      })),
    );
    expect(await count_artifacts(db, session.session_id)).toBe(texts.length);
    storage.reads.length = 0;

    const context = await build_replay_context(db, actor.workspace_id, session.session_id);

    expect(storage.reads).toHaveLength(0);
    const sent = JSON.stringify(context.messages);
    for (const text of texts) expect(sent).toContain(`listed ${text}`);
  });

  it('reads an image body once, then serves the next build from the cache', async () => {
    const storage = counted_object_storage();
    const db = await create_test_database();
    const actor = await bootstrap_default_workspace(db);
    const unique_image = Buffer.from(crypto.randomUUID().padEnd(40_000, 'i')).toString('base64');
    const session = await write_replay_session(db, actor, 'stored_on_tool_call', [
      {
        tool_name: 'workspace-view_image',
        result: {
          ok: true,
          content: [
            { type: 'text', text: 'A photo.' },
            { type: 'image', data: unique_image, mime_type: 'image/png' },
          ],
          content_text: 'A photo.',
          content_json: large_json('photo'),
        },
      },
    ]);
    storage.reads.length = 0;

    const first = await build_replay_context(db, actor.workspace_id, session.session_id);
    expect(storage.reads).toHaveLength(1);
    expect(JSON.stringify(first.messages)).toContain(unique_image);

    const second = await build_replay_context(db, actor.workspace_id, session.session_id);
    expect(storage.reads).toHaveLength(1);
    expect(second.messages).toEqual(first.messages);
  });
});

describe('a command result with a large stdout', () => {
  it('stores the stdout behind an artifact_ref, and a full read gives it back', async () => {
    set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
    const fixture = await create_fixture();
    const stdout = long_stdout(60_000);

    const returned = await run_command_printing(fixture, stdout);

    const tool_call_id = String(returned.metadata?.tool_call_id);
    const call = await get_tool_call(fixture.db, fixture.ids.workspace_id, tool_call_id);
    if (!call) throw new Error('The call was not stored.');
    const serialized_stdout = JSON.stringify(stdout);
    expect(call.output_data).toMatchObject({
      shape: 'tool_result_v2',
      metadata: {
        truncated: true,
        full_output_path: `system/tool-output/${tool_call_id}.txt`,
        command_result: {
          exit_code: 0,
          stderr: '',
          stdout: {
            artifact_ref: {
              artifact_id: expect.any(String),
              byte_size: Buffer.byteLength(serialized_stdout),
              preview: serialized_stdout.slice(0, 500),
            },
          },
        },
      },
    });
    const stored_text = JSON.stringify(call.output_data);
    expect(stored_text).not.toContain(stdout.slice(20_000, 21_000));
    expect(Buffer.byteLength(stored_text)).toBeLessThan(36_000);

    const [restored] = await restore_tool_call_outputs(fixture.db, {
      workspace_id: fixture.ids.workspace_id,
      rows: [call],
      reading: 'load_full_value',
    });
    const { tool_call_id: _id, ...engine_metadata } = returned.metadata ?? {};
    expect(restored?.output_data).toEqual({ ...returned, metadata: engine_metadata });
  });

  it.each([
    ['a private chat', { run_audience: 'narrow' }],
    ['a run that does not name its audience', {}],
  ])('saves the full stdout of %s to sandbox scratch, never the shared volume', async (_name, metadata) => {
    set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
    const fixture = await create_fixture();
    const files = new Map<string, string>();
    const stdout = long_stdout(60_000);

    const returned = await run_command_printing(fixture, stdout, metadata, files);

    const tool_call_id = String(returned.metadata?.tool_call_id);
    const saved_paths = [...files.keys()];
    expect(saved_paths).toContain(`tmp/tool-output/${tool_call_id}.txt`);
    expect(saved_paths.filter((saved_path) => saved_path.startsWith('system/'))).toEqual([]);
    const call = await get_tool_call(fixture.db, fixture.ids.workspace_id, tool_call_id);
    expect(call?.output_data).toMatchObject({
      metadata: { truncated: true, full_output_path: `tmp/tool-output/${tool_call_id}.txt` },
    });
  });

  it('replays the same model input from an inline row and a stored row, reading no body', async () => {
    const storage = counted_object_storage();
    const fixture = await create_fixture();
    const produced = await run_command_printing(fixture, long_stdout(60_000));
    const { tool_call_id: _id, ...metadata } = produced.metadata ?? {};
    const session_results = [
      { tool_name: 'workspace-run_command', result: { ...produced, metadata } },
    ];
    const { actor } = fixture;
    const v1 = await write_replay_session(fixture.db, actor, 'inline', session_results);
    const v2 = await write_replay_session(
      fixture.db,
      actor,
      'stored_on_tool_call',
      session_results,
    );
    expect(await count_artifacts(fixture.db, v2.session_id)).toBe(1);

    const v1_entries = await replay_entries(fixture.db, actor.workspace_id, v1.session_id);
    const v2_entries = await replay_entries(fixture.db, actor.workspace_id, v2.session_id);
    expect(JSON.stringify(v2_entries)).toBe(JSON.stringify(v1_entries));

    storage.reads.length = 0;
    const v2_model_entries = await replay_entries(
      fixture.db,
      actor.workspace_id,
      v2.session_id,
      'load_model_visible_value',
    );
    const v1_context = await build_replay_context(fixture.db, actor.workspace_id, v1.session_id);
    const v2_context = await build_replay_context(fixture.db, actor.workspace_id, v2.session_id);
    expect(storage.reads).toHaveLength(0);
    expect(v2_model_entries.map(model_visible_content)).toEqual(
      v1_entries.map(model_visible_content),
    );
    expect(model_texts(v2_context.messages)).toEqual(model_texts(v1_context.messages));
  });

  it('loads a stored metadata value for the model when metadata is all the model reads', async () => {
    set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
    const db = await create_test_database();
    const actor = await bootstrap_default_workspace(db);
    const session_results = [
      {
        tool_name: 'workspace-probe',
        result: { ok: true as const, metadata: { report: long_stdout(40_000), exit_code: 0 } },
      },
    ];
    const v1 = await write_replay_session(db, actor, 'inline', session_results);
    const v2 = await write_replay_session(db, actor, 'stored_on_tool_call', session_results);
    expect(await count_artifacts(db, v2.session_id)).toBe(1);

    const v1_entries = await replay_entries(db, actor.workspace_id, v1.session_id);
    const v2_model_entries = await replay_entries(
      db,
      actor.workspace_id,
      v2.session_id,
      'load_model_visible_value',
    );
    expect(v2_model_entries.map(model_visible_content)).toEqual(
      v1_entries.map(model_visible_content),
    );
  });
});

describe('run file lists', () => {
  it('leave out stored tool-result bodies and keep hidden spilled outputs', async () => {
    set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
    const fixture = await create_fixture();
    const result = await echo_tool(fixture, {
      ok: true,
      content_text: 'listed rows',
      content_json: large_json('rows'),
    });
    const call = await get_tool_call(
      fixture.db,
      fixture.ids.workspace_id,
      String(result?.metadata?.tool_call_id),
    );
    expect(call?.output_file_id).toEqual(expect.any(String));
    const spilled = await create_file(fixture.db, {
      workspace_id: fixture.ids.workspace_id,
      session_id: fixture.ids.session_id,
      run_id: fixture.ids.run_id,
      source_tool_call_id: call?.tool_call_id ?? null,
      file_purpose: 'tool_output',
      storage_provider: 'local_workspace',
      storage_key: '/workspace/.outputs/tool_output.txt',
      workspace_path: '/workspace/.outputs/tool_output.txt',
      is_visible: false,
      file_metadata: { reason: 'output_truncated' },
      actor_id: fixture.ids.actor_id,
    });

    const listed = await list_run_files(fixture.db, fixture.ids.workspace_id, fixture.ids.run_id);

    expect(listed).toEqual([spilled]);
    expect(listed.map((file) => file.file_id)).not.toContain(call?.output_file_id);
  });
});

const image_data = Buffer.from('p'.repeat(40_000)).toString('base64');
const results: Array<{ tool_name: string; result: RuntimeToolResult }> = [
  {
    tool_name: 'workspace-read_file',
    result: { ok: true, content_text: 'hello', content_json: { text: 'hello' } },
  },
  {
    tool_name: 'workspace-view_image',
    result: {
      ok: true,
      content: [
        { type: 'text', text: 'A chart.' },
        { type: 'image', data: image_data, mime_type: 'image/png' },
      ],
      content_text: 'A chart.',
      content_json: { summary: 'A chart.', image: { mime_type: 'image/png' } },
    },
  },
  {
    tool_name: 'workspace-list',
    result: {
      ok: true,
      content_json: {
        items: Array.from({ length: 900 }, (_, index) => ({
          index,
          name: `item ${index}`,
          size: 1024 * index,
        })),
      },
    },
  },
  {
    tool_name: 'workspace-run_command',
    result: { ok: false, error_code: 'exit_1', error_message: 'command failed' },
  },
];

async function write_replay_session(
  db: Database,
  actor: Awaited<ReturnType<typeof bootstrap_default_workspace>>,
  storage: 'inline' | 'stored_on_tool_call',
  session_results: typeof results = results,
) {
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
  const ids = {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    actor_id: actor.user_id,
  };
  await create_run_message(db, {
    ...ids,
    message_role: 'user',
    message_content: { type: 'text', text: 'Look around.' },
    source_type: 'dashboard',
  });
  for (const [index, { tool_name, result }] of session_results.entries()) {
    const model_tool_call_id = `call_${index}`;
    await create_run_message(db, {
      ...ids,
      message_role: 'assistant',
      message_content: {
        type: 'multimodal',
        parts: [
          {
            type: 'tool_call',
            id: model_tool_call_id,
            name: tool_name,
            arguments: { step: index },
          },
        ],
      },
      source_type: 'runtime',
    });
    const tool_call = await create_tool_call_started(db, {
      ...ids,
      tool_name,
      tool_input: { step: index },
      tool_call_metadata: { runtime_tool_call_id: model_tool_call_id },
    });
    if (storage === 'stored_on_tool_call') {
      await store_tool_call_output(db, {
        ...ids,
        tool_call_id: tool_call.tool_call_id,
        output: tool_result_v2_from_runtime_result(result),
        output_text: null,
      });
    }
    await create_persisted_tool_result_message(db, {
      ...ids,
      tool_call_id: tool_call.tool_call_id,
      model_tool_call_id,
      tool_name,
      result,
      result_is_stored_on_tool_call: storage === 'stored_on_tool_call',
    });
  }
  return session;
}

async function replay_entries(
  db: Database,
  workspace_id: string,
  session_id: string,
  reading: LargeValueReading = 'load_full_value',
) {
  const rows = await restore_run_message_tool_results(db, {
    workspace_id,
    rows: await list_session_messages(db, workspace_id, session_id),
    reading,
  });
  const { entries } = project_run_messages_to_pi_session_entries({
    messages: rows as HarnessRunMessage[],
  });
  return entries.map((entry, position) => ({
    ...entry,
    id: position,
    parentId: null,
    timestamp: null,
    ...('message' in entry ? { message: { ...entry.message, timestamp: 0 } } : {}),
  }));
}

function model_visible_content(entry: Awaited<ReturnType<typeof replay_entries>>[number]) {
  return 'message' in entry
    ? { role: entry.message.role, content: (entry.message as { content?: unknown }).content }
    : entry;
}

function large_json(label: string) {
  return {
    label,
    rows: Array.from({ length: 800 }, (_, index) => ({ index, note: `${label} `.repeat(8) })),
  };
}

function counted_object_storage() {
  const storage = create_in_memory_object_storage();
  const reads: string[] = [];
  const counted: ObjectStorage = {
    ...storage,
    read: (object_key) => {
      reads.push(object_key);
      return storage.read(object_key);
    },
  };
  set_memory_import_object_storage_for_tests(counted);
  return { reads };
}

function long_stdout(characters: number) {
  const lines: string[] = ['order_id,customer,amount'];
  for (let index = 0; lines.join('\n').length < characters; index += 1) {
    lines.push(`${index},customer ${index},${(index * 7.31).toFixed(2)}`);
  }
  return lines.join('\n').slice(0, characters);
}

async function run_command_printing(
  fixture: Fixture,
  stdout: string,
  metadata: Record<string, unknown> = { run_audience: 'workspace' },
  files = new Map<string, string>(),
) {
  const environment: SessionEnv = {
    env_key: 'sandbox_1',
    env_kind: 'remote_sandbox',
    exec: async () => ({ exit_code: 0, stdout, stderr: '' }),
    write: async (path, contents) => {
      files.set(path, contents);
    },
    read: async (path) => files.get(path) ?? '',
  };
  const tool = create_runtime_tool_definitions(fixture.db, {
    ...fixture.ids,
    environment,
  }).find((definition) => definition.tool_name === 'workspace-run_command');
  if (!tool?.execute) throw new Error('workspace-run_command is not offered.');
  const result = await tool.execute(
    { command: 'cat', args: ['orders.csv'] },
    {
      run_key: fixture.ids.run_id,
      session_key: fixture.ids.session_id,
      tool_call_id: 'model_cat',
      metadata,
      environment,
    },
  );
  expect(result).toMatchObject({ ok: true });
  return result as Extract<RuntimeToolResult, { ok: true }>;
}

function model_texts(messages: Array<{ content: MessageContent }>) {
  return messages.map((message) =>
    runtime_message_parts_text(message_content_to_runtime_parts(message.content)),
  );
}

function build_replay_context(db: Database, workspace_id: string, session_id: string) {
  return build_session_context(db, {
    workspace_id,
    session_id,
    system_instructions: 'You are a helpful coworker.',
  });
}

async function count_artifacts(db: Database, session_id: string) {
  const artifacts = await db.query.files.findMany({
    where: (table, { eq }) => eq(table.session_id, session_id),
  });
  return artifacts.length;
}

async function create_fixture() {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
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
  return {
    db,
    actor,
    ids: {
      workspace_id: actor.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      actor_id: actor.user_id,
    },
  };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

function echo_tool(fixture: Fixture, result: RuntimeToolResult) {
  const tool = create_logged_tool_definition(
    fixture.db,
    fixture.ids,
    {
      tool_name: 'workspace-echo',
      description: 'Returns a fixed result.',
      execute: async () => result,
    },
    {
      timeout_ms: 5_000,
      output_limit_bytes: 16_000,
      risk_class: 'read',
      approval_mode: 'auto',
      sandbox_required: false,
    },
  );
  return tool.execute?.(
    {},
    {
      run_key: fixture.ids.run_id,
      session_key: fixture.ids.session_id,
      tool_call_id: 'model_echo',
      metadata: {},
    },
  );
}

async function tool_result_rows(fixture: Fixture) {
  const rows = await list_run_messages(fixture.db, fixture.ids.workspace_id, fixture.ids.run_id);
  return rows.filter((row) => row.message_role === 'tool_result');
}

async function stored_tool_items(fixture: Fixture) {
  const events = await list_run_events(fixture.db, fixture.ids.workspace_id, fixture.ids.run_id);
  return events.flatMap((event) => {
    const item = (event.event_data as { item?: Record<string, unknown> }).item;
    return event.event_type === 'chat_event' && item?.item_type === 'tool_call' ? [item] : [];
  });
}
