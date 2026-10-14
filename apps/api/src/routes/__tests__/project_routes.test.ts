import { create_app } from '@api/app';
import { create_scope_item } from '@coworker/core/db/__tests__/create_scope_item';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { find_project } from '@coworker/core/db/queries/projects';
import { list_grants_for_resource } from '@coworker/core/db/queries/resource_grants';
import { replace_memory_scope_members_for_sweep } from '@coworker/core/db/queries/resource_grants_memory_scope_sweep';
import { describe, expect, it } from 'vitest';

const json = { 'Content-Type': 'application/json' };

async function app_with_project() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const app = create_app(db);
  const created = await app.request('/v1/projects', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ project_name: 'Acme Support' }),
  });
  const body = await created.json();
  return { db, app, bootstrap, project_id: body.data.project_id as string, created };
}

describe('POST /v1/projects', () => {
  it('creates a project whose creator is its manager', async () => {
    const { created, project_id } = await app_with_project();
    expect(created.status).toBe(201);
    expect(project_id).toMatch(/^proj_/);
  });

  it('reports a duplicate name as 409, not 500', async () => {
    const { app } = await app_with_project();
    const again = await app.request('/v1/projects', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ project_name: 'Acme Support' }),
    });
    expect(again.status).toBe(409);
  });
});

describe('SEV-1 — the membership_version bypass', () => {
  it('refuses to rewrite a project membership through /v1/access', async () => {
    const { db, app, bootstrap, project_id } = await app_with_project();

    const response = await app.request(`/v1/access/project/${project_id}`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({
        shared_with_everyone_in_the_workspace: false,
        shared_with: [{ person: 'usr_mallory', can: 'manage' }],
      }),
    });

    expect(response.status).toBe(422);
    const project = await find_project(db, {
      workspace_id: bootstrap.workspace_id,
      project_id,
    });
    expect(project?.membership_version).toBe(1);
  });
});

describe('SEV-1 — unauthorized writes', () => {
  it('rejects an unknown resource_type as a client error, not a 500', async () => {
    const { app } = await app_with_project();
    const response = await app.request('/v1/access/gadget/x', { method: 'GET' });
    expect(response.status).toBe(422);
  });

  it('refuses to remove the last manager of a project', async () => {
    const { app, bootstrap, project_id } = await app_with_project();
    const response = await app.request(
      `/v1/projects/${project_id}/members/user/${bootstrap.user_id}`,
      { method: 'DELETE' },
    );
    expect(response.status).toBe(409);
  });

  it('rejects a malformed grantee_type as a client error, not a raw schema error', async () => {
    const { app, project_id } = await app_with_project();
    const response = await app.request(`/v1/projects/${project_id}/members/gadget/usr_bob`, {
      method: 'DELETE',
    });
    expect(response.status).toBe(422);
  });
});

describe('memory scope rows stay out of the generic access door', () => {
  it('leaves a memory_scope row out of GET /v1/access when resource_type is not named', async () => {
    const { db, app, bootstrap } = await app_with_project();
    await create_scope_item(
      db,
      { workspace_id: bootstrap.workspace_id, actor_id: bootstrap.user_id },
      'group:slack:T1:C1',
    );
    await replace_memory_scope_members_for_sweep(db, {
      workspace_id: bootstrap.workspace_id,
      scope_key: 'group:slack:T1:C1',
      sweep_id: 'sweep_1',
      swept_time: new Date('2026-10-01T09:00:00.000Z'),
      members: [{ grantee_type: 'user', grantee_id: bootstrap.user_id, member_kind: 'member' }],
      actor_id: bootstrap.user_id,
    });

    const unfiltered = await app.request(
      `/v1/access?grantee_type=user&grantee_id=${bootstrap.user_id}`,
    );
    const body = await unfiltered.json();
    const unfiltered_types = body.data.grants.map(
      (grant: { resource_type: string }) => grant.resource_type,
    );
    expect(unfiltered_types).not.toContain('memory_scope');
    expect(unfiltered_types.length).toBeGreaterThan(0);

    const named = await app.request(
      `/v1/access?grantee_type=user&grantee_id=${bootstrap.user_id}&resource_type=memory_scope`,
    );
    const named_body = await named.json();
    expect(
      named_body.data.grants.map((grant: { resource_type: string }) => grant.resource_type),
    ).toEqual(['memory_scope']);
  });

  it('refuses a PUT that would replace a memory scope’s members through the generic door', async () => {
    const { db, app, bootstrap } = await app_with_project();
    const response = await app.request('/v1/access/memory_scope/group:slack:T1:C1', {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({
        shared_with_everyone_in_the_workspace: false,
        shared_with: [{ person: bootstrap.user_id, can: 'use' }],
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'validation_error',
        message: 'Memory scope members are owned by the member sync. Use the memory doors instead.',
      },
    });
    const written = await list_grants_for_resource(db, {
      workspace_id: bootstrap.workspace_id,
      resource_type: 'memory_scope',
      resource_id: 'group:slack:T1:C1',
    });
    expect(written).toEqual([]);
  });
});
