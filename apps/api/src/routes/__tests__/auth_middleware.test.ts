import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { describe, expect, it } from 'vitest';

const test_proxy_secret = 'local-development-internal-api-secret';

describe('api workspace middleware', () => {
  it('provisions request workspace context from authenticated provider headers', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await app.request('/v1/sessions', {
      headers: provider_headers({
        provider_key: 'workos',
        provider_user_id: 'user_123',
        organization_id: 'org_123',
        email: 'founder@example.com',
        first_name: 'Olivier',
        last_name: 'Park',
      }),
    });
    const workos_users = await db.query.users.findMany({
      where: (table, { eq }) => eq(table.external_identity_provider, 'workos'),
    });
    const workos_workspaces = await db.query.workspaces.findMany({
      where: (table, { eq }) => eq(table.external_identity_provider, 'workos'),
    });

    expect(response.status).toBe(200);
    expect(workos_users).toHaveLength(1);
    expect(workos_workspaces).toHaveLength(1);
    expect(workos_users[0]).toMatchObject({
      first_name: 'Olivier',
      last_name: 'Park',
    });
    expect(workos_workspaces[0]).toMatchObject({
      external_identity_id: 'organization:org_123',
    });
  });

  it('provisions the workspace without seeding a tool catalog', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await app.request('/v1/sessions', {
      headers: provider_headers({
        provider_key: 'workos',
        provider_user_id: 'user_unseeded',
        organization_id: 'org_unseeded',
        email: 'founder@example.com',
      }),
    });

    expect(response.status).toBe(200);
    expect(await db.query.workspaces.findMany()).toHaveLength(1);
    expect(await db.query.apps.findMany()).toEqual([]);
    expect(await db.query.nodes.findMany()).toEqual([]);
  });

  it('rejects requests that send the API proxy secret without a user actor', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await app.request('/v1/sessions', {
      headers: new Headers([[proxy_auth_headers.secret, test_proxy_secret]]),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthorized' },
    });
  });

  it('rejects anonymous requests outside the Vitest workspace fixture', async () => {
    const original_vitest = process.env.VITEST;
    const original_vitest_worker_id = process.env.VITEST_WORKER_ID;
    delete process.env.VITEST;
    delete process.env.VITEST_WORKER_ID;

    try {
      const db = await create_test_database();
      const app = create_app(db);

      const response = await app.request('/v1/sessions');

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'unauthorized' },
      });
    } finally {
      restore_env('VITEST', original_vitest);
      restore_env('VITEST_WORKER_ID', original_vitest_worker_id);
    }
  });

  it('rejects requests with an invalid API proxy secret', async () => {
    const db = await create_test_database();
    const app = create_app(db);
    const headers = provider_headers({
      provider_key: 'workos',
      provider_user_id: 'user_123',
      email: 'founder@example.com',
    });
    headers.set(proxy_auth_headers.secret, 'wrong-secret');

    const response = await app.request('/v1/sessions', { headers });

    expect(response.status).toBe(401);
  });
});

function provider_headers(input: {
  provider_key: string;
  provider_user_id: string;
  organization_id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}) {
  const headers = new Headers([[proxy_auth_headers.secret, test_proxy_secret]]);
  headers.set(proxy_auth_headers.provider_key, input.provider_key);
  headers.set(proxy_auth_headers.provider_user_id, input.provider_user_id);
  if (input.organization_id) headers.set(proxy_auth_headers.organization_id, input.organization_id);
  if (input.email) headers.set(proxy_auth_headers.email, input.email);
  if (input.first_name) headers.set(proxy_auth_headers.first_name, input.first_name);
  if (input.last_name) headers.set(proxy_auth_headers.last_name, input.last_name);
  return headers;
}

function restore_env(name: 'VITEST' | 'VITEST_WORKER_ID', value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
