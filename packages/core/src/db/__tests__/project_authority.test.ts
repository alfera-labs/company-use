import { assert_project_manager } from '@coworker/core/access/assert_project_manager';
import { check_resource_use } from '@coworker/core/access/check_resource_use';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  list_project_members,
  remove_project_member,
  set_project_member,
} from '@coworker/core/db/queries/project_members';
import { create_project, find_project } from '@coworker/core/db/queries/projects';
import { replace_resource_sharing } from '@coworker/core/db/queries/resource_grants';
import { describe, expect, it } from 'vitest';

async function workspace_with_project(project_name = 'Acme Support') {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const project = await create_project(db, {
    workspace_id: bootstrap.workspace_id,
    project_name,
    actor_id: bootstrap.user_id,
    owner_id: bootstrap.user_id,
  });
  return { db, workspace_id: bootstrap.workspace_id, user_id: bootstrap.user_id, project };
}

describe('project authority', () => {
  it('lets the creator manage their project, because create mints a manage grant', async () => {
    const { db, workspace_id, user_id, project } = await workspace_with_project();
    await expect(
      assert_project_manager(db, { workspace_id, project_id: project.project_id, user_id }),
    ).resolves.toBeUndefined();
  });

  it('refuses a member who holds no manage grant and is not a workspace admin', async () => {
    const { db, workspace_id, project } = await workspace_with_project();
    await expect(
      assert_project_manager(db, {
        workspace_id,
        project_id: project.project_id,
        user_id: 'usr_mallory',
      }),
    ).rejects.toMatchObject({ code: 'project_access_denied', status: 403 });
  });

  it('accepts a plain member once they are granted manage', async () => {
    const { db, workspace_id, user_id, project } = await workspace_with_project();
    await set_project_member(db, {
      workspace_id,
      project_id: project.project_id,
      grantee_type: 'user',
      grantee_id: 'usr_bob',
      grant_level: 'use',
      actor_id: user_id,
    });
    await expect(
      assert_project_manager(db, {
        workspace_id,
        project_id: project.project_id,
        user_id: 'usr_bob',
      }),
    ).rejects.toMatchObject({ status: 403 });

    await set_project_member(db, {
      workspace_id,
      project_id: project.project_id,
      grantee_type: 'user',
      grantee_id: 'usr_bob',
      grant_level: 'manage',
      actor_id: user_id,
    });
    await expect(
      assert_project_manager(db, {
        workspace_id,
        project_id: project.project_id,
        user_id: 'usr_bob',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('project membership invariants', () => {
  it('refuses to remove the last manager', async () => {
    const { db, workspace_id, user_id, project } = await workspace_with_project();
    await expect(
      remove_project_member(db, {
        workspace_id,
        project_id: project.project_id,
        grantee_type: 'user',
        grantee_id: user_id,
        actor_id: user_id,
      }),
    ).rejects.toMatchObject({ status: 409 });

    const members = await list_project_members(db, {
      workspace_id,
      project_id: project.project_id,
    });
    expect(members.map((member) => member.grantee_id)).toEqual([user_id]);
  });

  it('allows removing a manager once a second one exists', async () => {
    const { db, workspace_id, user_id, project } = await workspace_with_project();
    await set_project_member(db, {
      workspace_id,
      project_id: project.project_id,
      grantee_type: 'user',
      grantee_id: 'usr_bob',
      grant_level: 'manage',
      actor_id: user_id,
    });
    await remove_project_member(db, {
      workspace_id,
      project_id: project.project_id,
      grantee_type: 'user',
      grantee_id: user_id,
      actor_id: user_id,
    });
    const after = await find_project(db, { workspace_id, project_id: project.project_id });
    expect(after?.membership_version).toBe(3);
  });

  it('reports a duplicate project name as a conflict, not a driver error', async () => {
    const { db, workspace_id, user_id } = await workspace_with_project('Growth');
    await expect(
      create_project(db, {
        workspace_id,
        project_name: 'Growth',
        actor_id: user_id,
        owner_id: user_id,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('sharing writes', () => {
  it('leaves an unrestricted resource usable', async () => {
    const { db, workspace_id, project } = await workspace_with_project();
    const verdict = await check_resource_use(db, {
      workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_stripe',
      participants: { project: [project.project_id], agent: ['agt_ext'], user: ['usr_alice'] },
    });
    expect(verdict).toEqual({ allowed: true, grant_level: 'use' });
  });

  it('serializes concurrent sharing replaces instead of merging them', async () => {
    const { db, workspace_id, user_id } = await workspace_with_project();
    const put = (who: string) =>
      replace_resource_sharing(db, {
        workspace_id,
        resource_type: 'connection',
        resource_id: 'conn_x',
        shared_with: [{ grantee_type: 'user', grantee_id: who, grant_level: 'use' }],
        actor_id: user_id,
      });
    await Promise.all([put('usr_a'), put('usr_b')]);

    const verdict = await check_resource_use(db, {
      workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_x',
      participants: { project: [], agent: [], user: ['usr_a', 'usr_b'] },
    });
    expect(verdict.allowed).toBe(false);
  });
});
