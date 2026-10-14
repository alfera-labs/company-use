import { create_scope_item } from '@coworker/core/db/__tests__/create_scope_item';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { add_resource_grant } from '@coworker/core/db/queries/resource_grant_entries';
import {
  list_grants_for_grantee,
  list_grants_for_resource,
} from '@coworker/core/db/queries/resource_grants';
import {
  type MemoryScopeMember,
  replace_memory_scope_members_for_sweep,
} from '@coworker/core/db/queries/resource_grants_memory_scope_sweep';
import { brain_items } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const slack_channel = 'group:slack:T1:C1';
const first_sweep_time = new Date('2026-10-01T09:00:00.000Z');
const second_sweep_time = new Date('2026-10-01T10:00:00.000Z');
const third_sweep_time = new Date('2026-10-01T11:00:00.000Z');

async function workspace() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const owner = { workspace_id: bootstrap.workspace_id, actor_id: bootstrap.user_id };
  await create_scope_item(db, owner, slack_channel);
  return { db, ...owner };
}

async function read_scope_item_metadata(db: Database, scope_key: string) {
  const [row] = await db
    .select({ metadata: brain_items.metadata })
    .from(brain_items)
    .where(eq(brain_items.scope_key, scope_key));
  return row?.metadata ?? null;
}

function member(grantee_id: string): MemoryScopeMember {
  return { grantee_type: 'user', grantee_id, member_kind: 'member' };
}

function sweep(
  db: Database,
  owner: { workspace_id: string; actor_id: string },
  input: { sweep_id: string; swept_time: Date; members: MemoryScopeMember[]; scope_key?: string },
) {
  return replace_memory_scope_members_for_sweep(db, {
    workspace_id: owner.workspace_id,
    scope_key: input.scope_key ?? slack_channel,
    sweep_id: input.sweep_id,
    swept_time: input.swept_time,
    members: input.members,
    actor_id: owner.actor_id,
  });
}

function scope_rows(db: Database, workspace_id: string, scope_key = slack_channel) {
  return list_grants_for_resource(db, {
    workspace_id,
    resource_type: 'memory_scope',
    resource_id: scope_key,
  });
}

describe('replace_memory_scope_members_for_sweep', () => {
  it('upserts the sweep members and tags each row with the sweep id and time', async () => {
    const { db, ...owner } = await workspace();

    const result = await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [
        member('usr_alice'),
        { grantee_type: 'source_actor', grantee_id: 'sact_bot_1', member_kind: 'guest' },
      ],
    });

    if (result.outcome !== 'swept') throw new Error(`unexpected outcome ${result.outcome}`);
    const by_grantee = new Map(result.rows.map((row) => [row.grantee_id, row.metadata]));
    expect(by_grantee.get('usr_alice')).toEqual({
      sweep_id: 'sweep_1',
      swept_time: '2026-10-01T09:00:00.000Z',
      member_kind: 'member',
    });
    expect(by_grantee.get('sact_bot_1')).toEqual({
      sweep_id: 'sweep_1',
      swept_time: '2026-10-01T09:00:00.000Z',
      member_kind: 'guest',
    });
  });

  it('removes a member the next sweep no longer lists, and keeps the rest', async () => {
    const { db, ...owner } = await workspace();
    await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_alice'), member('usr_bob')],
    });

    const result = await sweep(db, owner, {
      sweep_id: 'sweep_2',
      swept_time: second_sweep_time,
      members: [member('usr_alice')],
    });

    expect(result.outcome).toBe('swept');
    const remaining = await scope_rows(db, owner.workspace_id);
    expect(remaining.map((row) => row.grantee_id)).toEqual(['usr_alice']);
  });

  it('leaves an admin manage grant unchanged through two sweeps', async () => {
    const { db, ...owner } = await workspace();
    const admin_grant = await add_resource_grant(db, {
      workspace_id: owner.workspace_id,
      resource_type: 'memory_scope',
      resource_id: slack_channel,
      grantee_type: 'user',
      grantee_id: 'usr_admin',
      grant_level: 'manage',
      actor_id: owner.actor_id,
    });

    await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_admin'), member('usr_alice')],
    });
    await sweep(db, owner, { sweep_id: 'sweep_2', swept_time: second_sweep_time, members: [] });

    const remaining = await scope_rows(db, owner.workspace_id);
    expect(remaining).toEqual([admin_grant]);
  });

  it('ignores a late sweep older than one already written, so it deletes no newer member', async () => {
    const { db, ...owner } = await workspace();
    await sweep(db, owner, {
      sweep_id: 'sweep_2',
      swept_time: second_sweep_time,
      members: [member('usr_bob')],
    });

    const late = await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_alice')],
    });

    expect(late).toEqual({
      outcome: 'superseded_by_newer_sweep',
      newest_swept_time: '2026-10-01T10:00:00.000Z',
    });
    const remaining = await scope_rows(db, owner.workspace_id);
    expect(remaining.map((row) => [row.grantee_id, row.metadata])).toEqual([
      [
        'usr_bob',
        { sweep_id: 'sweep_2', swept_time: '2026-10-01T10:00:00.000Z', member_kind: 'member' },
      ],
    ]);
  });

  it('ignores a late sweep even when the newer sweep emptied the scope and left no grant row', async () => {
    const { db, ...owner } = await workspace();
    await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_alice')],
    });
    const emptied = await sweep(db, owner, {
      sweep_id: 'sweep_2',
      swept_time: second_sweep_time,
      members: [],
    });
    expect(emptied.outcome).toBe('swept');
    expect(await scope_rows(db, owner.workspace_id)).toEqual([]);

    const late = await sweep(db, owner, {
      sweep_id: 'sweep_0_late',
      swept_time: first_sweep_time,
      members: [member('usr_alice')],
    });

    expect(late).toEqual({
      outcome: 'superseded_by_newer_sweep',
      newest_swept_time: '2026-10-01T10:00:00.000Z',
    });
    expect(await scope_rows(db, owner.workspace_id)).toEqual([]);
  });

  it('records the watermark for an empty sweep by merging it into the scope item, keeping other keys', async () => {
    const { db, ...owner } = await workspace();
    await db
      .update(brain_items)
      .set({ metadata: { scope_label: 'Support channel' } })
      .where(eq(brain_items.scope_key, slack_channel));

    await sweep(db, owner, { sweep_id: 'sweep_1', swept_time: first_sweep_time, members: [] });

    expect(await read_scope_item_metadata(db, slack_channel)).toEqual({
      scope_label: 'Support channel',
      last_member_sweep_time: '2026-10-01T09:00:00.000Z',
    });
  });

  it('fails closed when the scope has no brain item, writing no grants', async () => {
    const { db, ...owner } = await workspace();
    const unknown_scope = 'group:slack:T1:C999';

    const result = await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_alice')],
      scope_key: unknown_scope,
    });

    expect(result).toEqual({ outcome: 'scope_item_not_found' });
    expect(await scope_rows(db, owner.workspace_id, unknown_scope)).toEqual([]);
  });

  it('orders two concurrent calls on one PGlite connection so the newer sweep wins (see resource_grants_memory_scope_sweep_lock.test.ts for the real two-connection race)', async () => {
    const { db, ...owner } = await workspace();

    const [first, second] = await Promise.all([
      sweep(db, owner, {
        sweep_id: 'sweep_older',
        swept_time: second_sweep_time,
        members: [member('usr_alice')],
      }),
      sweep(db, owner, {
        sweep_id: 'sweep_newer',
        swept_time: third_sweep_time,
        members: [member('usr_bob')],
      }),
    ]);

    expect([first.outcome, second.outcome].sort()).toEqual(['swept', 'swept']);
    const remaining = await scope_rows(db, owner.workspace_id);
    expect(remaining.map((row) => row.grantee_id)).toEqual(['usr_bob']);
    expect(await read_scope_item_metadata(db, slack_channel)).toEqual({
      last_member_sweep_time: '2026-10-01T11:00:00.000Z',
    });
  });

  it('leaves a different scope untouched', async () => {
    const { db, ...owner } = await workspace();
    await create_scope_item(db, owner, 'project:proj_support');
    await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_alice')],
    });
    await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_bob')],
      scope_key: 'project:proj_support',
    });

    await sweep(db, owner, { sweep_id: 'sweep_2', swept_time: second_sweep_time, members: [] });

    const other_scope = await scope_rows(db, owner.workspace_id, 'project:proj_support');
    expect(other_scope.map((row) => row.grantee_id)).toEqual(['usr_bob']);
    expect(await scope_rows(db, owner.workspace_id)).toEqual([]);
  });

  it('is excluded from the generic grantee listing door, unless memory_scope is named', async () => {
    const { db, ...owner } = await workspace();
    await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_alice')],
    });
    await add_resource_grant(db, {
      workspace_id: owner.workspace_id,
      resource_type: 'node',
      resource_id: 'issue_refund',
      grantee_type: 'user',
      grantee_id: 'usr_alice',
      grant_level: 'use',
      actor_id: owner.actor_id,
    });

    const alice = { workspace_id: owner.workspace_id, grantee_type: 'user' as const };
    const unfiltered = await list_grants_for_grantee(db, { ...alice, grantee_id: 'usr_alice' });
    expect(unfiltered.map((row) => row.resource_type)).toEqual(['node']);

    const named = await list_grants_for_grantee(db, {
      ...alice,
      grantee_id: 'usr_alice',
      resource_type: 'memory_scope',
    });
    expect(named.map((row) => row.resource_type)).toEqual(['memory_scope']);
  });
});
