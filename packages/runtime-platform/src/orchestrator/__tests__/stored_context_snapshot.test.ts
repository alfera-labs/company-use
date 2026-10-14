import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_run_files } from '@coworker/core/db/queries/files';
import {
  create_run,
  create_session,
  list_run_model_context_snapshots,
} from '@coworker/core/db/queries/sessions';
import { create_in_memory_object_storage } from '@runtime-platform/files/in_memory_object_storage';
import { set_memory_import_object_storage_for_tests } from '@runtime-platform/files/object_storage';
import {
  read_context_snapshots,
  store_run_model_context_snapshot,
} from '@runtime-platform/orchestrator/context/stored_context_snapshot';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  set_memory_import_object_storage_for_tests(undefined);
  vi.restoreAllMocks();
});

describe('stored context snapshots', () => {
  it('keeps a small snapshot inline and reads inline and pointer rows in one call', async () => {
    const storage = create_in_memory_object_storage();
    set_memory_import_object_storage_for_tests(storage);
    const fixture = await create_fixture();
    const small = { engine_input: { messages: [{ role: 'user', text: 'hi' }] } };
    const large = { engine_input: { messages: [{ role: 'user', text: 'x'.repeat(40_000) }] } };

    await store_snapshot(fixture, small);
    await store_snapshot(fixture, large);

    const rows = await list_run_model_context_snapshots(
      fixture.db,
      fixture.ids.workspace_id,
      fixture.ids.run_id,
    );
    expect(rows[0]?.snapshot).toEqual(small);
    expect(rows[1]?.snapshot).toMatchObject({ shape: 'context_snapshot_ref_v1' });
    expect(storage.objects.size).toBe(1);
    expect(await list_run_files(fixture.db, fixture.ids.workspace_id, fixture.ids.run_id)).toEqual(
      [],
    );

    const read = await read_context_snapshots(fixture.db, {
      workspace_id: fixture.ids.workspace_id,
      rows,
    });
    expect(read.map((row) => row.snapshot)).toEqual([small, large]);
  });

  it('keeps a large snapshot inline when object storage is not configured', async () => {
    const fixture = await create_fixture();
    const large = { engine_input: { text: 'z'.repeat(40_000) } };

    await store_snapshot(fixture, large);

    const [row] = await list_run_model_context_snapshots(
      fixture.db,
      fixture.ids.workspace_id,
      fixture.ids.run_id,
    );
    expect(row?.snapshot).toEqual(large);
  });
});

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

function store_snapshot(fixture: Awaited<ReturnType<typeof create_fixture>>, snapshot: unknown) {
  return store_run_model_context_snapshot(fixture.db, {
    ...fixture.ids,
    snapshot_kind: 'engine_input',
    message_count: 1,
    tool_count: 0,
    token_estimate: 10,
    snapshot,
    actor_id: fixture.actor_id,
  });
}
