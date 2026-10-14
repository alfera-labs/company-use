import {
  build_workspace,
  group_scope_key,
} from '@api/routes/__tests__/access_memory_scope_fixture';
import { read_data, request_json } from '@api/routes/__tests__/connection_audience_org';
import { mint_workspace_api_key } from '@api/services/api_keys';
import { list_grants_for_resource } from '@coworker/core/db/queries/resource_grants';
import { describe, expect, it } from 'vitest';

describe('editing who reads a memory scope', () => {
  it('lets an admin hand-add an API key as a reader through the generic grantees route', async () => {
    const { db, app, admin, workspace_id } = await build_workspace();
    const { api_key } = await mint_workspace_api_key(db, {
      workspace_id,
      user_id: admin.user_id,
      key_name: 'generic route key',
      scopes: ['memory.read'],
      key_audience: 'internal',
    });

    await read_data(
      app,
      admin.headers,
      'POST',
      `/v1/access/memory_scope/${group_scope_key}/grantees`,
      { api_key: api_key.api_key_id, can: 'use' },
    );

    const grants = await list_grants_for_resource(db, {
      workspace_id,
      resource_type: 'memory_scope',
      resource_id: group_scope_key,
    });
    expect(grants.map((grant) => grant.grantee_id)).toContain(api_key.api_key_id);
  });

  it('refuses a non-admin', async () => {
    const { app, member } = await build_workspace();
    const response = await request_json(
      app,
      member.headers,
      'POST',
      `/v1/access/memory_scope/${group_scope_key}/grantees`,
      { person: member.user_id, can: 'use' },
    );
    expect(response.status).toBe(403);
  });

  it('refuses to edit the company (workspace) memory scope', async () => {
    const { app, admin, member } = await build_workspace();
    const response = await request_json(
      app,
      admin.headers,
      'POST',
      '/v1/access/memory_scope/workspace/grantees',
      { person: member.user_id, can: 'use' },
    );
    expect(response.status).toBe(422);
  });

  it('refuses to edit a project memory scope directly, pointing at project membership', async () => {
    const { app, admin, member, project_id } = await build_workspace();
    const response = await request_json(
      app,
      admin.headers,
      'POST',
      `/v1/access/memory_scope/project:${project_id}/grantees`,
      { person: member.user_id, can: 'use' },
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.message).toMatch(/project members/);
  });

  it('answers 404 for a scope that does not exist', async () => {
    const { app, admin, member } = await build_workspace();
    const response = await request_json(
      app,
      admin.headers,
      'POST',
      '/v1/access/memory_scope/group:slack:T1:unknown/grantees',
      { person: member.user_id, can: 'use' },
    );
    expect(response.status).toBe(404);
  });
});
