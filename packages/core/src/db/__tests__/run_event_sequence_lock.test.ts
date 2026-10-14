import { randomUUID } from 'node:crypto';
import { create_database } from '@coworker/core/db/connection';
import { create_run_events } from '@coworker/core/db/queries/sessions';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

// The one test that can prove the sequence allocator serializes: PGlite is a single connection, so
// every "concurrent" batch there is really sequential. This talks to Postgres from two connections
// and skips on a machine that has none (no `bun run db:start`).
//
// CI is not allowed to skip it. The postgres-concurrency job sets
// COWORKER_REQUIRE_POSTGRES_TESTS against its Postgres service, so losing the database turns into a
// failure here instead of a green run with the only race-detecting test quietly switched off —
// which is how the original bug shipped.
const database_url = process.env.DATABASE_URL;

if (process.env.COWORKER_REQUIRE_POSTGRES_TESTS === 'true' && !database_url) {
  throw new Error(
    'COWORKER_REQUIRE_POSTGRES_TESTS is set but DATABASE_URL is not — the run-event sequence lock test cannot run',
  );
}
const test_workspace_id = 'ws_seq_lock_test';
const clients: postgres.Sql[] = [];

afterAll(async () => {
  for (const client of clients) {
    await client`DELETE FROM run_events WHERE workspace_id = ${test_workspace_id}`;
    await client.end();
  }
});

describe.skipIf(!database_url)('run event sequence allocation', () => {
  it('reads the high-water mark only after the run lock is held', async () => {
    if (!database_url) return;
    const db = create_database(database_url);
    const lock_holder = postgres(database_url, { max: 2, prepare: false });
    clients.push(lock_holder);

    const run_id = `run_seq_lock_${randomUUID()}`;
    const base = {
      workspace_id: test_workspace_id,
      session_id: 'ses_seq_lock_test',
      run_id,
      actor_id: 'system:test',
    };

    const lock_is_held = create_signal();
    const may_write = create_signal();
    const writer_finished = lock_holder.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('run_events'), hashtext(${run_id}))`;
      lock_is_held.send();
      await may_write.received;
      await tx`
        INSERT INTO run_events (
          run_event_id, workspace_id, session_id, run_id, event_sequence, event_type,
          created_by, last_updated_by
        )
        VALUES (
          ${`evt_${randomUUID()}`}, ${base.workspace_id}, ${base.session_id}, ${run_id}, 1,
          'progress', ${base.actor_id}, ${base.actor_id}
        )
      `;
    });

    await lock_is_held.received;
    const batch_written = create_run_events(db, {
      ...base,
      events: [{ event_type: 'progress' }, { event_type: 'progress' }],
    });
    await wait_for_a_waiter_on_the_run_lock(lock_holder, run_id);
    may_write.send();

    const batch = await batch_written;
    await writer_finished;

    expect(batch.map((row) => row.event_sequence)).toEqual([2, 3]);
  });
});

function create_signal() {
  let send: () => void = () => undefined;
  const received = new Promise<void>((resolve) => {
    send = resolve;
  });
  return { received, send: () => send() };
}

async function wait_for_a_waiter_on_the_run_lock(client: postgres.Sql, run_id: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [waiter] = await client`
      SELECT 1
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND NOT granted
        AND classid::bigint = hashtext('run_events')::bigint & 4294967295
        AND objid::bigint = hashtext(${run_id})::bigint & 4294967295
    `;
    if (waiter) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('No writer ever waited on the run event lock');
}
