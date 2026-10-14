import { create_scope_item } from '@coworker/core/db/__tests__/create_scope_item';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  type MemoryScopeMember,
  replace_memory_scope_grants,
} from '@coworker/core/db/queries/memory_scope_grants';
import { add_resource_grant } from '@coworker/core/db/queries/resource_grant_entries';
import { list_grants_for_resource } from '@coworker/core/db/queries/resource_grants';
import { describe, expect, it } from 'vitest';

const slack_channel = 'group:slack:T1:C1';
const first_sweep_time = new Date('2026-10-01T09:00:00.000Z');
const second_sweep_time = new Date('2026-10-01T10:00:00.000Z');

async function workspace() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const owner = { workspace_id: bootstrap.workspace_id, actor_id: bootstrap.user_id };
  await create_scope_item(db, owner, slack_channel);
  return { db, ...owner };
}

function member(grantee_id: string): MemoryScopeMember {
  return { grantee_type: 'user', grantee_id, member_kind: 'member' };
}

function sweep(
  db: Database,
  owner: { workspace_id: string; actor_id: string },
  input: { sweep_id: string; swept_time: Date; members: MemoryScopeMember[]; scope_key?: string },
) {
  return replace_memory_scope_grants(db, {
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

describe('replace_memory_scope_grants', () => {
  it('reports every newly granted member as added on the first sweep', async () => {
    const { db, ...owner } = await workspace();

    const result = await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_alice'), member('usr_bob')],
    });

    expect(result).toEqual({
      outcome: 'swept',
      added: expect.arrayContaining(['usr_alice', 'usr_bob']),
      removed: [],
    });
    if (result.outcome === 'swept') expect(result.added).toHaveLength(2);
  });

  it('reports added 0, removed 0 when the same member list is swept again', async () => {
    const { db, ...owner } = await workspace();
    await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_alice')],
    });

    const result = await sweep(db, owner, {
      sweep_id: 'sweep_2',
      swept_time: second_sweep_time,
      members: [member('usr_alice')],
    });

    expect(result).toEqual({ outcome: 'swept', added: [], removed: [] });
  });

  it('reports exactly the member who left and the member who joined', async () => {
    const { db, ...owner } = await workspace();
    await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_alice'), member('usr_bob')],
    });

    const result = await sweep(db, owner, {
      sweep_id: 'sweep_2',
      swept_time: second_sweep_time,
      members: [member('usr_alice'), member('usr_carol')],
    });

    expect(result).toEqual({ outcome: 'swept', added: ['usr_carol'], removed: ['usr_bob'] });
  });

  it('never reports a manual grant without a sweep tag as added or removed, and it survives', async () => {
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

    const first = await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_alice')],
    });
    expect(first).toEqual({ outcome: 'swept', added: ['usr_alice'], removed: [] });

    const second = await sweep(db, owner, {
      sweep_id: 'sweep_2',
      swept_time: second_sweep_time,
      members: [],
    });
    expect(second).toEqual({ outcome: 'swept', added: [], removed: ['usr_alice'] });

    const remaining = await scope_rows(db, owner.workspace_id);
    expect(remaining).toEqual([admin_grant]);
  });

  it('passes a superseded late sweep through unchanged, with no added/removed computed', async () => {
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

  it('keeps the added/removed count scoped to one workspace, even when another workspace reuses the same scope key', async () => {
    const { db, ...owner } = await workspace();
    const other_workspace_id = 'ws_memory_scope_grants_other';
    await create_scope_item(
      db,
      { workspace_id: other_workspace_id, actor_id: owner.actor_id },
      slack_channel,
    );

    await sweep(db, owner, {
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_alice')],
    });

    const other_result = await replace_memory_scope_grants(db, {
      workspace_id: other_workspace_id,
      scope_key: slack_channel,
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      members: [member('usr_alice')],
      actor_id: owner.actor_id,
    });

    expect(other_result).toEqual({ outcome: 'swept', added: ['usr_alice'], removed: [] });
    expect((await scope_rows(db, owner.workspace_id)).map((row) => row.grantee_id)).toEqual([
      'usr_alice',
    ]);
    expect((await scope_rows(db, other_workspace_id)).map((row) => row.grantee_id)).toEqual([
      'usr_alice',
    ]);
  });
});
