import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_run_event,
  create_run_events,
  create_run_message,
  create_session,
  list_run_events,
  list_session_messages_for_model_context,
} from '@coworker/core/db/queries/sessions';
import { describe, expect, it } from 'vitest';

async function create_run_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'Run events',
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
    db,
    base: {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      actor_id: bootstrap.user_id,
    },
  };
}

describe('run event batches', () => {
  it('numbers a batch in order and returns the inserted rows', async () => {
    const { db, base } = await create_run_fixture();

    const rows = await create_run_events(db, {
      ...base,
      events: [
        { event_type: 'start', event_label: 'first' },
        { event_type: 'progress', event_label: 'second', event_data: { step: 2 } },
        { event_type: 'end', event_label: 'third' },
      ],
    });

    expect(rows.map((row) => row.event_sequence)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.event_label)).toEqual(['first', 'second', 'third']);
    expect(rows[1]?.event_data).toEqual({ step: 2 });
    expect(rows.every((row) => row.run_event_id.startsWith('evt_'))).toBe(true);
  });

  it('continues from the sequence already on the run', async () => {
    const { db, base } = await create_run_fixture();
    await create_run_events(db, {
      ...base,
      events: [{ event_type: 'start' }, { event_type: 'progress' }],
    });

    const second_batch = await create_run_events(db, {
      ...base,
      events: [{ event_type: 'progress' }, { event_type: 'end' }],
    });

    expect(second_batch.map((row) => row.event_sequence)).toEqual([3, 4]);
  });

  it('keeps the single-event path on the same allocator', async () => {
    const { db, base } = await create_run_fixture();
    await create_run_events(db, { ...base, events: [{ event_type: 'start' }] });

    const single = await create_run_event(db, {
      ...base,
      event_type: 'progress',
      event_label: 'one at a time',
    });

    expect(single.event_sequence).toBe(2);
  });

  it('numbers many interleaved batches on one run without gaps', async () => {
    const { db, base } = await create_run_fixture();

    // Several writers on one run — the orchestrator loop and every tool in a parallel batch do
    // this today. This test database is one connection, so it proves the allocation arithmetic,
    // not the locking; run_event_sequence_lock.test.ts holds the lock from a second real
    // connection to prove the race (a lock taken inside the reading statement lets a waiter
    // compute the high-water mark from pre-lock data under READ COMMITTED and collide).
    await Promise.all(
      Array.from({ length: 6 }, () =>
        create_run_events(db, {
          ...base,
          events: [{ event_type: 'progress' }, { event_type: 'progress' }],
        }),
      ),
    );

    const stored = await list_run_events(db, base.workspace_id, base.run_id);
    const sequences = stored.map((row) => row.event_sequence).sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(sequences).size).toBe(12);
  });

  it('writes nothing for an empty batch', async () => {
    const { db, base } = await create_run_fixture();
    await expect(create_run_events(db, { ...base, events: [] })).resolves.toEqual([]);
    await expect(list_run_events(db, base.workspace_id, base.run_id)).resolves.toEqual([]);
  });

  it('strips NUL bytes that Postgres jsonb rejects', async () => {
    const { db, base } = await create_run_fixture();

    const [row] = await create_run_events(db, {
      ...base,
      events: [{ event_type: 'progress', event_data: { text: 'before\u0000after' } }],
    });

    expect(row?.event_data).toEqual({ text: 'beforeafter' });
  });
});

describe('list_session_messages_for_model_context', () => {
  it('returns only visible conversation rows, newest window, oldest first', async () => {
    const { db, base } = await create_run_fixture();

    const write = (
      message_role: 'user' | 'assistant' | 'event',
      text: string,
      is_model_visible = true,
    ) =>
      create_run_message(db, {
        workspace_id: base.workspace_id,
        session_id: base.session_id,
        run_id: base.run_id,
        message_role,
        message_content: { type: 'text', text },
        is_model_visible,
        source_type: 'dashboard',
        actor_id: base.actor_id,
      });

    await write('user', 'first');
    await write('event', 'progress noise');
    await write('assistant', 'hidden draft', false);
    await write('assistant', 'answer one');
    await write('user', 'second');
    await write('assistant', 'answer two');

    const window = await list_session_messages_for_model_context(
      db,
      base.workspace_id,
      base.session_id,
      { limit: 3 },
    );

    expect(
      window.map((row) => [row.message_role, (row.message_content as { text: string }).text]),
    ).toEqual([
      ['assistant', 'answer one'],
      ['user', 'second'],
      ['assistant', 'answer two'],
    ]);
    expect(window.every((row) => typeof row.token_count === 'number' && row.token_count > 0)).toBe(
      true,
    );
  });
});
