import { check_resource_use } from '@coworker/core/access/check_resource_use';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  list_project_members,
  remove_project_member,
  set_project_member,
} from '@coworker/core/db/queries/project_members';
import {
  create_project,
  find_project,
  list_projects,
  list_projects_for_grantee,
} from '@coworker/core/db/queries/projects';
import {
  list_grants_for_grantee,
  replace_resource_sharing,
} from '@coworker/core/db/queries/resource_grants';
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

describe('projects', () => {
  it('mints the creator as a manage member, so a new project is never unopenable', async () => {
    const { db, workspace_id, user_id, project } = await workspace_with_project();
    const members = await list_project_members(db, {
      workspace_id,
      project_id: project.project_id,
    });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      resource_type: 'project',
      resource_id: project.project_id,
      grantee_type: 'user',
      grantee_id: user_id,
      grant_level: 'manage',
    });
  });

  it('advances membership_version when a member is added', async () => {
    const { db, workspace_id, user_id, project } = await workspace_with_project();
    expect(project.membership_version).toBe(1);

    await set_project_member(db, {
      workspace_id,
      project_id: project.project_id,
      grantee_type: 'user',
      grantee_id: 'usr_bob',
      grant_level: 'use',
      actor_id: user_id,
    });

    const after = await find_project(db, { workspace_id, project_id: project.project_id });
    expect(after?.membership_version).toBe(2);
  });

  it('advances membership_version when a member is REMOVED', async () => {
    const { db, workspace_id, user_id, project } = await workspace_with_project();
    await set_project_member(db, {
      workspace_id,
      project_id: project.project_id,
      grantee_type: 'user',
      grantee_id: 'usr_bob',
      grant_level: 'use',
      actor_id: user_id,
    });

    await remove_project_member(db, {
      workspace_id,
      project_id: project.project_id,
      grantee_type: 'user',
      grantee_id: 'usr_bob',
      actor_id: user_id,
    });

    const after = await find_project(db, { workspace_id, project_id: project.project_id });
    expect(after?.membership_version).toBe(3);
    const members = await list_project_members(db, {
      workspace_id,
      project_id: project.project_id,
    });
    expect(members.map((member) => member.grantee_id)).toEqual([user_id]);
  });

  it('stations a coworker on the membership list beside people, many projects to many agents', async () => {
    const { db, workspace_id, user_id, project } = await workspace_with_project();
    const second = await create_project(db, {
      workspace_id,
      project_name: 'Acme Internal',
      actor_id: user_id,
      owner_id: user_id,
    });

    for (const project_id of [project.project_id, second.project_id]) {
      await set_project_member(db, {
        workspace_id,
        project_id,
        grantee_type: 'agent',
        grantee_id: 'agt_ext',
        grant_level: 'use',
        actor_id: user_id,
      });
    }

    const stationed = await list_projects_for_grantee(db, {
      workspace_id,
      grantee_type: 'agent',
      grantee_id: 'agt_ext',
    });
    expect(stationed.map((row) => row.project_name).sort()).toEqual([
      'Acme Internal',
      'Acme Support',
    ]);
  });

  it('filters the project search in SQL rather than loading the workspace', async () => {
    const { db, workspace_id, user_id } = await workspace_with_project();
    await create_project(db, {
      workspace_id,
      project_name: 'Growth',
      actor_id: user_id,
      owner_id: user_id,
    });
    const found = await list_projects(db, { workspace_id, query: 'grow' });
    expect(found.map((row) => row.project_name)).toEqual(['Growth']);
  });
});

describe('access grants', () => {
  it('leaves an unrestricted connection usable, so existing workspaces are untouched', async () => {
    const { db, workspace_id, project } = await workspace_with_project();
    const verdict = await check_resource_use(db, {
      workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_stripe',
      participants: { project: [project.project_id], agent: ['agt_ext'], user: ['usr_alice'] },
    });
    expect(verdict).toEqual({ allowed: true, grant_level: 'use' });
  });

  it('limits a connection to one project once a single row exists', async () => {
    const { db, workspace_id, user_id, project } = await workspace_with_project();
    await replace_resource_sharing(db, {
      workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_stripe',
      shared_with: [
        { grantee_type: 'project', grantee_id: project.project_id, grant_level: 'use' },
      ],
      actor_id: user_id,
    });

    const inside = await check_resource_use(db, {
      workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_stripe',
      participants: { project: [project.project_id], agent: ['agt_ext'], user: ['usr_alice'] },
    });
    const outside = await check_resource_use(db, {
      workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_stripe',
      participants: { project: ['proj_other'], agent: ['agt_ext'], user: ['usr_alice'] },
    });

    expect(inside.allowed).toBe(true);
    expect(outside).toMatchObject({ allowed: false, blocked_grantee_type: 'project' });
  });

  it('replaces an audience declaratively, so repeating a call changes nothing', async () => {
    const { db, workspace_id, user_id, project } = await workspace_with_project();
    const sharing = [
      {
        grantee_type: 'project' as const,
        grantee_id: project.project_id,
        grant_level: 'use' as const,
      },
      { grantee_type: 'user' as const, grantee_id: 'usr_alice', grant_level: 'use' as const },
    ];
    const first = await replace_resource_sharing(db, {
      workspace_id,
      resource_type: 'node',
      resource_id: 'issue_refund',
      shared_with: sharing,
      actor_id: user_id,
    });
    const second = await replace_resource_sharing(db, {
      workspace_id,
      resource_type: 'node',
      resource_id: 'issue_refund',
      shared_with: sharing,
      actor_id: user_id,
    });
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
  });

  it('makes a resource shared again by clearing its rows, the only spelling of shared', async () => {
    const { db, workspace_id, user_id, project } = await workspace_with_project();
    await replace_resource_sharing(db, {
      workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_stripe',
      shared_with: [
        { grantee_type: 'project', grantee_id: project.project_id, grant_level: 'use' },
      ],
      actor_id: user_id,
    });
    await replace_resource_sharing(db, {
      workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_stripe',
      shared_with: [],
      actor_id: user_id,
    });

    const verdict = await check_resource_use(db, {
      workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_stripe',
      participants: { project: ['proj_other'], agent: ['agt_ext'], user: ['usr_alice'] },
    });
    expect(verdict).toEqual({ allowed: true, grant_level: 'use' });
  });

  it('enumerates everything one person holds in a single read', async () => {
    const { db, workspace_id, user_id, project } = await workspace_with_project();
    await replace_resource_sharing(db, {
      workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_gmail',
      shared_with: [{ grantee_type: 'user', grantee_id: user_id, grant_level: 'manage' }],
      actor_id: user_id,
    });

    const held = await list_grants_for_grantee(db, {
      workspace_id,
      grantee_type: 'user',
      grantee_id: user_id,
    });
    const held_keys = held.map((grant) => `${grant.resource_type}:${grant.resource_id}`).sort();
    expect(held_keys).toContain('connection:conn_gmail');
    expect(held_keys).toContain(`project:${project.project_id}`);
    expect(held_keys.filter((key) => key.startsWith('project:'))).toHaveLength(3);
    expect(held_keys).toHaveLength(4);
  });
});
