import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_run_files } from '@coworker/core/db/queries/files';
import {
  create_run,
  create_run_events,
  create_session,
  list_run_events,
} from '@coworker/core/db/queries/sessions';
import type { ChatStreamEventDraft } from '@coworker/shared';
import { record_chat_stream_event_drafts } from '@runtime-platform/chat_stream/chat_stream_events';
import { publish_live_run_event } from '@runtime-platform/chat_stream/live_run_events';
import { read_run_events } from '@runtime-platform/chat_stream/run_event_reads';
import { create_in_memory_object_storage } from '@runtime-platform/files/in_memory_object_storage';
import { set_memory_import_object_storage_for_tests } from '@runtime-platform/files/object_storage';
import { backfill_run_event_payloads } from '@runtime-platform/orchestrator/run_event_payload_backfill';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  set_memory_import_object_storage_for_tests(undefined);
  vi.restoreAllMocks();
});

describe('stored run event payloads', () => {
  it('writes a large chat event as a pointer, sends the full body live, and reads it back whole', async () => {
    const fixture = await create_fixture();
    const draft = large_tool_item_draft(fixture.ids, 'a');

    const [inline_event] = await record(fixture, [draft]);
    const storage = counting_storage();
    set_memory_import_object_storage_for_tests(storage);
    const [pointer_event] = await record(fixture, [draft]);

    expect(pointer_event).toMatchObject({ item: { output_data: draft_item(draft).output_data } });
    const published = [inline_event, pointer_event].map((event) => {
      const sent: unknown[] = [];
      publish_live_run_event({ publish: (value) => sent.push(value) }, {
        type: 'chat_event',
        event,
      } as never);
      return strip_event_ids(sent[0]);
    });
    expect(storage.reads).toBe(0);
    expect(published[1]).toBe(published[0]);
    expect(published[1]).toContain('a'.repeat(1_000));

    const [inline_row, pointer_row] = await list_run_events(
      fixture.db,
      fixture.ids.workspace_id,
      fixture.ids.run_id,
    );
    expect(inline_row?.metadata).toEqual({});
    expect(pointer_row?.metadata).toEqual({ payload_shape: 'run_event_payload_v2' });
    expect(pointer_row?.event_data).toMatchObject({
      item: { output_data: { artifact_ref: { artifact_id: expect.any(String) } } },
    });
    expect(JSON.stringify(pointer_row?.event_data).length).toBeLessThan(4_000);
    expect(storage.objects.size).toBe(1);
    expect(await list_run_files(fixture.db, fixture.ids.workspace_id, fixture.ids.run_id)).toEqual(
      [],
    );

    const read = await read_all(fixture, 'load_full_value');
    expect(storage.reads).toBe(1);
    expect(strip_ids(read[1])).toBe(strip_ids(read[0]));
    expect(inline_event?.event_id).not.toBe(pointer_event?.event_id);
  });

  it('keeps a large event inline and logs when object storage refuses it', async () => {
    const fixture = await create_fixture();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = create_in_memory_object_storage();
    set_memory_import_object_storage_for_tests({
      ...storage,
      put_if_absent: async () => {
        throw new Error('bucket unreachable');
      },
    });

    await record(fixture, [large_tool_item_draft(fixture.ids, 'b')]);

    const [row] = await list_run_events(fixture.db, fixture.ids.workspace_id, fixture.ids.run_id);
    expect(row?.metadata).toEqual({});
    expect(JSON.stringify(row?.event_data)).toContain('b'.repeat(15_000));
    expect(errors).toHaveBeenCalled();
    expect(await fixture.db.query.files.findMany()).toEqual([]);
  });

  it('reads a preview without touching storage', async () => {
    const fixture = await create_fixture();
    const storage = counting_storage();
    set_memory_import_object_storage_for_tests(storage);
    await record(fixture, [large_tool_item_draft(fixture.ids, 'd')]);

    const [row] = await read_all(fixture, 'use_preview');

    expect(storage.reads).toBe(0);
    expect(row?.metadata).toEqual({});
    expect(row?.event_data).toMatchObject({
      item: { output_data: { wire_truncated: true, original_chars: expect.any(Number) } },
    });
  });

  it('backfill moves only large old rows, once, and readers see the same events', async () => {
    const fixture = await create_fixture();
    const large_payload = { tool_call_id: 'call_1', is_error: false, result: text_result('e') };
    await create_run_events(fixture.db, {
      ...fixture.ids,
      actor_id: fixture.actor_id,
      events: [
        { event_type: 'start', event_data: { event_type: 'start', message_count: 1 } },
        {
          event_type: 'progress',
          event_label: 'pi.tool_execution_end',
          event_data: { event_type: 'progress', label: 'pi.tool_execution_end' },
          event_metadata: large_payload,
        },
      ],
    });
    const before = await read_all(fixture, 'load_full_value');
    const storage = counting_storage();
    set_memory_import_object_storage_for_tests(storage);

    const dry_run = await backfill_run_event_payloads(fixture.db, dry_run_options);
    expect(dry_run).toMatchObject({ looked_at: 1, moved: 1, values: 1 });
    expect(storage.objects.size).toBe(0);
    expect(await read_all(fixture, 'load_full_value')).toEqual(before);

    const first = await backfill_run_event_payloads(fixture.db, write_options);
    const second = await backfill_run_event_payloads(fixture.db, write_options);

    expect(first).toMatchObject({ looked_at: 1, moved: 1, values: 1 });
    expect(second).toMatchObject({ looked_at: 0, moved: 0 });
    const rows = await list_run_events(fixture.db, fixture.ids.workspace_id, fixture.ids.run_id);
    expect(rows.map((row) => row.metadata)).toEqual([
      {},
      { payload_shape: 'run_event_payload_v2' },
    ]);
    expect(rows[1]?.event_metadata).toMatchObject({
      result: { content: { artifact_ref: expect.any(Object) }, details: { rows: 3 } },
    });
    expect(payloads(await read_all(fixture, 'load_full_value'))).toBe(payloads(before));
    expect(rows[1]?.last_updated_by).toBe('system');
  });
});

const dry_run_options = { write: false, limit: 100, batch_size: 10 };
const write_options = { write: true, limit: 100, batch_size: 10 };

async function create_fixture() {
  const db = await create_test_database();
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
  return {
    db,
    ids: { workspace_id: actor.workspace_id, session_id: session.session_id, run_id: run.run_id },
    actor_id: actor.user_id,
  };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

function record(fixture: Fixture, drafts: ChatStreamEventDraft[]) {
  return record_chat_stream_event_drafts(fixture.db, {
    ...fixture.ids,
    drafts,
    actor_id: fixture.actor_id,
  });
}

async function read_all(fixture: Fixture, payload_reading: 'load_full_value' | 'use_preview') {
  const rows = await list_run_events(fixture.db, fixture.ids.workspace_id, fixture.ids.run_id);
  return read_run_events(fixture.db, {
    workspace_id: fixture.ids.workspace_id,
    rows,
    payload_reading,
  });
}

function large_tool_item_draft(ids: Fixture['ids'], letter: string): ChatStreamEventDraft {
  const time = '2026-09-26T00:00:00.000Z';
  return {
    event_type: 'item_completed',
    source: { source_type: 'runtime_event', runtime_event_id: 'evt_1', runtime_event_sequence: 4 },
    item: {
      ...ids,
      item_id: 'item_tool_1',
      item_type: 'tool_call',
      item_status: 'failed',
      item_sequence: 4,
      created_time: time,
      last_updated_time: time,
      tool_call_id: 'call_1',
      tool_name: 'search',
      tool_kind: 'integration',
      tool_status: 'failed',
      error: { code: 'tool_failed', message: 'The search failed.' },
      output_data: {
        first: letter.repeat(15_000),
        second: letter.repeat(15_000),
        third: 'c'.repeat(15_000),
      },
      file_ids: [],
    },
  } as ChatStreamEventDraft;
}

function draft_item(draft: ChatStreamEventDraft) {
  return (draft as { item: { output_data: unknown } }).item;
}

function text_result(letter: string) {
  return { content: [{ type: 'text', text: letter.repeat(40_000) }], details: { rows: 3 } };
}

function strip_ids(row: unknown) {
  const { run_event_id, event_sequence, created_time, last_updated_time, ...rest } = row as Record<
    string,
    unknown
  >;
  return JSON.stringify(rest);
}

function payloads(
  rows: Array<{ event_data: unknown; event_metadata: unknown; metadata: unknown }>,
) {
  return JSON.stringify(
    rows.map(({ event_data, event_metadata, metadata }) => ({
      event_data,
      event_metadata,
      metadata,
    })),
  );
}

function strip_event_ids(published: unknown) {
  const { event } = published as { event: Record<string, unknown> };
  const { event_id: _id, sequence: _sequence, occurred_time: _time, ...rest } = event;
  return JSON.stringify(rest);
}

function counting_storage() {
  const storage = create_in_memory_object_storage();
  const counted = {
    ...storage,
    reads: 0,
    read: async (object_key: string) => {
      counted.reads += 1;
      return storage.read(object_key);
    },
  };
  return counted;
}
