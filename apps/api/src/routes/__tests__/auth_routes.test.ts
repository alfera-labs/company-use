import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { describe, expect, it } from 'vitest';

const test_proxy_secret = 'local-development-internal-api-secret';

describe('auth routes', () => {
  it('provisions a workspace from an authenticated provider identity', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await app.request('/v1/auth/workspace', {
      method: 'POST',
      headers: new Headers([
        [proxy_auth_headers.secret, test_proxy_secret],
        ['content-type', 'application/json'],
      ]),
      body: JSON.stringify({
        provider_key: 'workos',
        provider_user_id: 'user_123',
        organization_id: 'org_123',
        email: 'founder@example.com',
        first_name: 'Olivier',
        last_name: 'Park',
        user_data: { locale: 'en-US' },
        workspace_data: { source: 'auth-route-test' },
      }),
    });
    const body = await response.json();
    const user = await db.query.users.findFirst({
      where: (table, { eq }) => eq(table.external_identity_id, 'user_123'),
    });
    const workspace = await db.query.workspaces.findFirst({
      where: (table, { eq }) => eq(table.external_identity_id, 'organization:org_123'),
    });
    const member = await db.query.workspace_members.findFirst({
      where: (table, { eq }) =>
        eq(table.external_identity_id, 'organization_membership:org_123:user_123'),
    });
    const agent = workspace
      ? await db.query.agents.findFirst({
          where: (table, { and, eq }) =>
            and(eq(table.workspace_id, workspace.workspace_id), eq(table.agent_slug, 'main')),
        })
      : null;

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      data: {
        user_id: user?.user_id,
        workspace_id: workspace?.workspace_id,
        agent_id: agent?.agent_id,
      },
    });
    expect(user).toMatchObject({
      external_identity_provider: 'workos',
      first_name: 'Olivier',
      last_name: 'Park',
      user_data: { locale: 'en-US' },
    });
    expect(workspace).toMatchObject({
      external_identity_provider: 'workos',
      workspace_data: { source: 'auth-route-test' },
    });
    expect(member).toMatchObject({ member_role: 'owner' });
    expect(agent).toMatchObject({ agent_status: 'active' });
  });

  it('rejects provisioning without the API proxy secret', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await app.request('/v1/auth/workspace', {
      method: 'POST',
      headers: new Headers([['content-type', 'application/json']]),
      body: JSON.stringify({
        provider_key: 'workos',
        provider_user_id: 'user_123',
      }),
    });

    expect(response.status).toBe(401);
  });

  it('refuses a signed-in person on the routes the dashboard server calls for them: a body can not name a role', async () => {
    const db = await create_test_database();
    const app = create_app(db);
    const machine = new Headers([
      [proxy_auth_headers.secret, test_proxy_secret],
      ['content-type', 'application/json'],
    ]);
    const a_member = {
      provider_key: 'workos',
      provider_user_id: 'user_member',
      organization_id: 'org_123',
      member_role: 'member',
    };
    const joined = await app.request('/v1/auth/workspace', {
      method: 'POST',
      headers: machine,
      body: JSON.stringify(a_member),
    });
    const as_that_person = new Headers(machine);
    as_that_person.set(proxy_auth_headers.provider_key, 'workos');
    as_that_person.set(proxy_auth_headers.provider_user_id, 'user_member');
    as_that_person.set(proxy_auth_headers.organization_id, 'org_123');

    const answers = await Promise.all(
      [
        ['/v1/auth/workspace', { ...a_member, member_role: 'owner' }],
        ['/v1/auth/workspace/create', { ...a_member, member_role: 'owner', name: 'Mine' }],
        ['/v1/auth/active-organization', a_member],
      ].map(([path, body]) =>
        app.request(String(path), {
          method: 'POST',
          headers: as_that_person,
          body: JSON.stringify(body),
        }),
      ),
    );
    const member = await db.query.workspace_members.findFirst({
      where: (table, { eq }) =>
        eq(table.external_identity_id, 'organization_membership:org_123:user_member'),
    });

    expect(joined.status).toBe(201);
    expect(answers.map((answer) => answer.status)).toEqual([403, 403, 403]);
    expect(member).toMatchObject({ member_role: 'member' });
  });

  it('authenticates machine bootstrap routes before validating their bodies', async () => {
    const db = await create_test_database();
    const app = create_app(db);
    const route_paths = [
      '/v1/auth/workspace',
      '/v1/auth/active-organization',
      '/v1/auth/workspace/create',
    ];

    for (const path of route_paths) {
      for (const body of ['{}', '{']) {
        const response = await app.request(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        expect(response.status).toBe(401);
        expect((await response.json()).error.code).toBe('unauthorized');
      }
    }
  });

  it('returns the standard validation error for authenticated malformed JSON', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await app.request('/v1/auth/workspace', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [proxy_auth_headers.secret]: test_proxy_secret,
      },
      body: '{',
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: 'validation_error',
      message: 'Request body must be valid JSON',
    });
  });
});
