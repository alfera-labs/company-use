import { check_resource_use } from '@coworker/core/access/check_resource_use';
import { describe_resource_use } from '@coworker/core/access/describe_resource_use';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { add_resource_grant } from '@coworker/core/db/queries/resource_grant_entries';
import { resource_grants } from '@coworker/core/db/schema/projects';
import { create_id, id_prefixes } from '@coworker/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const scope_key = 'group:slack:T1:C1';

describe('check_resource_use on a memory scope', () => {
  it('denies a memory scope that has no grants at all', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const verdict = await check_resource_use(db, {
      workspace_id: bootstrap.workspace_id,
      resource_type: 'memory_scope',
      resource_id: scope_key,
      participants: { project: [], agent: [], user: [bootstrap.user_id] },
    });

    expect(verdict).toEqual({
      allowed: false,
      denial_reason: 'nothing_is_granted',
      blocked_grantee_type: null,
      blocked_grantee_ids: [],
    });
  });

  it('denies a scope that carries a grant whose grantee type is not registered', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await add_resource_grant(db, {
      workspace_id: bootstrap.workspace_id,
      resource_type: 'memory_scope',
      resource_id: scope_key,
      grantee_type: 'user',
      grantee_id: bootstrap.user_id,
      grant_level: 'manage',
      actor_id: bootstrap.user_id,
    });
    await db.execute(
      sql`ALTER TABLE resource_grants DROP CONSTRAINT resource_grants_grantee_check`,
    );
    await db.insert(resource_grants).values({
      resource_grant_id: create_id(id_prefixes.resource_grant),
      workspace_id: bootstrap.workspace_id,
      resource_type: 'memory_scope',
      resource_id: scope_key,
      grantee_type: 'slack_guest',
      grantee_id: 'U_GUEST_1',
      grant_level: 'manage',
      created_by: bootstrap.user_id,
      last_updated_by: bootstrap.user_id,
    });

    const verdict = await check_resource_use(db, {
      workspace_id: bootstrap.workspace_id,
      resource_type: 'memory_scope',
      resource_id: scope_key,
      participants: { project: [], agent: [], user: [bootstrap.user_id] },
    });

    expect(verdict).toEqual({
      allowed: false,
      denial_reason: 'unregistered_grantee_type',
      blocked_grantee_type: null,
      blocked_grantee_ids: ['U_GUEST_1'],
    });
    expect(describe_resource_use(verdict, { resource_label: 'Memory scope' })).toBe(
      'Memory scope is shared with a kind of party this workspace cannot check, so nobody can open it.',
    );
  });
});
