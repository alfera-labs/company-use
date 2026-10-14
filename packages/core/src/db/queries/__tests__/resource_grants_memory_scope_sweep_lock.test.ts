import { create_scope_item } from '@coworker/core/db/__tests__/create_scope_item';
import { create_database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_grants_for_resource } from '@coworker/core/db/queries/resource_grants';
import { replace_memory_scope_members_for_sweep } from '@coworker/core/db/queries/resource_grants_memory_scope_sweep';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const database_url = process.env.DATABASE_URL;

if (process.env.COWORKER_REQUIRE_POSTGRES_TESTS === 'true' && !database_url) {
  throw new Error(
    'COWORKER_REQUIRE_POSTGRES_TESTS is set but DATABASE_URL is not — the memory scope sweep lock test cannot run',
  );
}

const older_sweep_time = new Date('2026-10-01T10:00:00.000Z');
const newer_sweep_time = new Date('2026-10-01T11:00:00.000Z');
const clients: postgres.Sql[] = [];

afterAll(async () => {
  for (const client of clients) await client.end();
});

describe.skipIf(!database_url)(
  'replace_memory_scope_members_for_sweep on two real Postgres connections, not PGlite single-connection ordering',
  () => {
    it('serializes an older sweep behind a newer sweep through SELECT ... FOR UPDATE on the scope item, so the older sweep loses the race instead of re-granting a removed member', async () => {
      if (!database_url) return;
      const db_a = create_database(database_url);
      const db_b = create_database(database_url);
      const lock_holder = postgres(database_url, { max: 2, prepare: false });
      clients.push(lock_holder);

      const bootstrap = await bootstrap_default_workspace(db_a);
      const owner = { workspace_id: bootstrap.workspace_id, actor_id: bootstrap.user_id };
      const scope_key = `group:slack:T1:LOCK${Date.now()}`;
      await create_scope_item(db_a, owner, scope_key);

      const lock_is_held = create_signal();
      const may_release_the_lock = create_signal();
      const blocker_transaction = lock_holder.begin(async (tx) => {
        await tx`
          SELECT 1 FROM brain_items
          WHERE workspace_id = ${owner.workspace_id} AND scope_key = ${scope_key}
          FOR UPDATE
        `;
        lock_is_held.send();
        await may_release_the_lock.received;
      });
      await lock_is_held.received;

      const newer = replace_memory_scope_members_for_sweep(db_a, {
        workspace_id: owner.workspace_id,
        scope_key,
        sweep_id: 'sweep_newer',
        swept_time: newer_sweep_time,
        members: [{ grantee_type: 'user', grantee_id: 'usr_bob', member_kind: 'member' }],
        actor_id: owner.actor_id,
      });
      await wait_for_a_waiter_on_the_scope_lock(lock_holder);
      const older = replace_memory_scope_members_for_sweep(db_b, {
        workspace_id: owner.workspace_id,
        scope_key,
        sweep_id: 'sweep_older',
        swept_time: older_sweep_time,
        members: [{ grantee_type: 'user', grantee_id: 'usr_alice', member_kind: 'member' }],
        actor_id: owner.actor_id,
      });
      await wait_for_two_waiters_on_the_scope_lock(lock_holder);
      may_release_the_lock.send();

      await blocker_transaction;
      const [newer_result, older_result] = await Promise.all([newer, older]);

      expect(newer_result.outcome).toBe('swept');
      expect(older_result).toEqual({
        outcome: 'superseded_by_newer_sweep',
        newest_swept_time: newer_sweep_time.toISOString(),
      });
      const remaining = await list_grants_for_resource(db_a, {
        workspace_id: owner.workspace_id,
        resource_type: 'memory_scope',
        resource_id: scope_key,
      });
      expect(remaining.map((row) => row.grantee_id)).toEqual(['usr_bob']);
    });
  },
);

function create_signal() {
  let send: () => void = () => undefined;
  const received = new Promise<void>((resolve) => {
    send = resolve;
  });
  return { received, send: () => send() };
}

async function wait_for_a_waiter_on_the_scope_lock(client: postgres.Sql) {
  await wait_for_n_waiters_on_the_scope_lock(client, 1);
}

async function wait_for_two_waiters_on_the_scope_lock(client: postgres.Sql) {
  await wait_for_n_waiters_on_the_scope_lock(client, 2);
}

async function wait_for_n_waiters_on_the_scope_lock(client: postgres.Sql, waiters: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await client`
      SELECT count(*)::int AS n
      FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    if (Number(rows[0]?.n ?? 0) >= waiters) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`No ${waiters} waiter(s) ever appeared on the scope item lock`);
}
