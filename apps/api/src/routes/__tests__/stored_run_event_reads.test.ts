import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import type { RunEventToCreate } from '@coworker/core/db/queries/sessions';
import { create_run, create_session, list_run_events } from '@coworker/core/db/queries/sessions';
import { run_events } from '@coworker/core/db/schema';
import { list_session_run_chat_events_after } from '@runtime-platform/chat_stream/live_run_events';
import { create_in_memory_object_storage } from '@runtime-platform/files/in_memory_object_storage';
import { set_memory_import_object_storage_for_tests } from '@runtime-platform/files/object_storage';
import { create_stored_run_events } from '@runtime-platform/orchestrator/stored_run_event_payloads';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => set_memory_import_object_storage_for_tests(undefined));

describe('stored run event payloads through the read routes', () => {
  it('answers every reader with the bytes an inline row gives', async () => {
    const context = await create_context();
    set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
    await create_stored_run_events(context.db, {
      ...context.ids,
      actor_id: context.actor_id,
      events: large_run_events(context.ids),
    });

    const stored_rows = await list_run_events(
      context.db,
      context.ids.workspace_id,
      context.ids.run_id,
    );
    expect(stored_rows.map((row) => row.metadata)).toEqual([
      {},
      { payload_shape: 'run_event_payload_v2' },
      { payload_shape: 'run_event_payload_v2' },
      { payload_shape: 'run_event_payload_v2' },
      {},
    ]);
    const stored_bytes = stored_rows.reduce((sum, row) => sum + JSON.stringify(row).length, 0);
    expect(stored_bytes).toBeLessThan(12_000);
    const from_pointers = await read_every_route(context);

    for (const [index, row] of stored_rows.entries()) {
      const event = large_run_events(context.ids)[index];
      await context.db
        .update(run_events)
        .set({
          event_data: event?.event_data ?? {},
          event_metadata: event?.event_metadata ?? {},
          metadata: {},
        })
        .where(eq(run_events.run_event_id, row.run_event_id));
    }
    const from_inline_rows = await read_every_route(context);

    expect(from_pointers.sse).toContain('z'.repeat(40_000));
    expect(from_pointers.inspect).toContain('x'.repeat(40_000));
    for (const route of Object.keys(from_inline_rows) as Array<keyof typeof from_inline_rows>) {
      expect({ route, body: from_pointers[route] }).toEqual({
        route,
        body: from_inline_rows[route],
      });
    }
  });
});

async function create_context() {
  const db = await create_test_database();
  const app = create_app(db);
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'Stored run event reads',
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  return {
    app,
    db,
    actor_id: bootstrap.user_id,
    ids: {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
    },
  };
}

type Context = Awaited<ReturnType<typeof create_context>>;

async function read_every_route(context: Context) {
  const run_id = context.ids.run_id;
  const text = async (path: string, headers: Record<string, string> = {}) =>
    (await context.app.fetch(new Request(`http://localhost${path}`, { headers }))).text();
  return {
    sse: await text(`/v1/runs/${run_id}/events`, { Accept: 'text/event-stream' }),
    events: await text(`/v1/runs/${run_id}/events`),
    chat_stream_events: await text(`/v1/runs/${run_id}/chat-stream-events`),
    inspect: await text(`/v1/runs/${run_id}/inspect`),
    events_after: JSON.stringify(
      await list_session_run_chat_events_after(context.db, { ...context.ids, after_sequence: 0 }),
    ),
  };
}

function large_run_events(ids: Context['ids']): RunEventToCreate[] {
  const time = '2026-09-26T00:00:00.000Z';
  const item = {
    ...ids,
    item_id: 'item_tool_1',
    item_type: 'tool_call',
    item_status: 'completed',
    item_sequence: 2,
    created_time: time,
    last_updated_time: time,
    tool_call_id: 'call_1',
    tool_name: 'search',
    tool_kind: 'integration',
    tool_status: 'completed',
    input_data: { query: 'invoices' },
    output_data: { rows: 'x'.repeat(40_000), count: 3 },
    output_text: 'y'.repeat(40_000),
    file_ids: [],
  };
  return [
    { event_type: 'start', event_label: 'start', event_data: { event_type: 'start' } },
    {
      event_type: 'chat_event',
      event_label: 'item_completed',
      event_data: { event_type: 'item_completed', item, source: { source_type: 'runtime_event' } },
    },
    {
      event_type: 'progress',
      event_label: 'pi.tool_execution_end',
      event_data: { event_type: 'progress', label: 'pi.tool_execution_end' },
      event_metadata: {
        tool_call_id: 'call_1',
        is_error: false,
        result: { content: [{ type: 'text', text: 'x'.repeat(40_000) }], details: {} },
      },
    },
    {
      event_type: 'message',
      event_label: 'message',
      event_data: {
        event_type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'z'.repeat(40_000) }] },
      },
    },
    { event_type: 'end', event_label: 'completed', event_data: { event_type: 'end' } },
  ];
}
