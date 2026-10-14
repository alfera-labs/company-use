import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { create_api_key } from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { api_keys, workspace_members } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

type App = ReturnType<typeof create_app>;

let db: Database;
let app: App;
let workspace_id: string;
let user_id: string;

async function mint_key(body: Record<string, unknown>) {
  const response = await app.request('/v1/api-keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key_name: 'expiring key', scopes: ['workspace.read'], ...body }),
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      data?: { api_key: { api_key_id: string; expires_time: string | null }; secret: string };
      error?: { code: string };
    },
  };
}

async function read_workspace(secret: string) {
  const response = await app.request('/v1/workspace', {
    headers: { authorization: `Bearer ${secret}` },
  });
  return {
    status: response.status,
    body: (await response.json()) as { error?: { code: string } },
  };
}

beforeEach(async () => {
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  workspace_id = bootstrap.workspace_id;
  user_id = bootstrap.user_id;
  app = create_app(db);
});

describe('minting an API key with an expiry', () => {
  it('stops accepting the key once its expiry passes', async () => {
    const expires_time = new Date(Date.now() + 60_000);
    const minted = await mint_key({ expires_time: expires_time.toISOString() });

    expect(minted.status).toBe(201);
    if (!minted.body.data) throw new Error('API key mint response did not include data');
    expect(minted.body.data.api_key.expires_time).toBe(expires_time.toISOString());
    const secret = minted.body.data.secret;
    expect((await read_workspace(secret)).status).toBe(200);

    await db
      .update(api_keys)
      .set({
        expires_time: new Date(Date.now() - 1000),
        last_updated_time: new Date(),
        last_updated_by: user_id,
      })
      .where(eq(api_keys.api_key_id, minted.body.data.api_key.api_key_id));

    const expired = await read_workspace(secret);
    expect(expired.status).toBe(401);
    expect(expired.body.error?.code).toBe('api_key_expired');
  });

  it('refuses an expiry that is already in the past', async () => {
    const minted = await mint_key({
      expires_time: new Date(Date.now() - 60_000).toISOString(),
    });

    expect(minted.status).toBe(422);
    expect(minted.body.error?.code).toBe('validation_error');
  });

  it('mints a non-expiring key when no expiry is asked for', async () => {
    const minted = await mint_key({});

    expect(minted.status).toBe(201);
    expect(minted.body.data?.api_key.expires_time).toBeNull();
    expect((await read_workspace(minted.body.data?.secret ?? '')).status).toBe(200);
  });
});

describe('administering workspace API keys', () => {
  it.each(['owner', 'admin'])('permits the %s role', async (role) => {
    await set_default_member_role(db, user_id, role);
    const existing = await create_a_key();

    const minted = await mint_key({});
    const listed = await list_keys();
    const revoked = await revoke_key(existing.api_key_id);

    expect(minted.status).toBe(201);
    expect(listed.status).toBe(200);
    expect(listed.body.data?.map((key) => key.api_key_id)).toContain(existing.api_key_id);
    expect(revoked.status).toBe(200);
  });

  it.each(['member', 'viewer'])('refuses the %s role', async (role) => {
    await set_default_member_role(db, user_id, role);
    const existing = await create_a_key();

    const minted = await mint_key({});
    const listed = await list_keys();
    const revoked = await revoke_key(existing.api_key_id);

    for (const attempt of [minted, listed, revoked]) {
      expect(attempt.status).toBe(403);
      expect(attempt.body.error?.code).toBe('api_key_access_denied');
    }
    expect(minted.body.data).toBeUndefined();
    expect(await db.query.api_keys.findMany()).toHaveLength(1);
    expect((await db.query.api_keys.findFirst())?.revoked_time).toBeNull();
  });
});

async function create_a_key() {
  const { api_key } = await create_api_key(db, {
    workspace_id,
    key_name: 'another team production key',
    scopes: ['memory.read'],
    key_audience: 'internal',
    environment_label: 'test',
    actor_id: user_id,
  });
  return api_key;
}

async function list_keys() {
  const response = await app.request('/v1/api-keys');
  return {
    status: response.status,
    body: (await response.json()) as {
      data?: { api_key_id: string }[];
      error?: { code: string };
    },
  };
}

async function revoke_key(api_key_id: string) {
  const response = await app.request(`/v1/api-keys/${api_key_id}/revoke`, { method: 'POST' });
  return {
    status: response.status,
    body: (await response.json()) as { error?: { code: string } },
  };
}

function set_default_member_role(db: Database, user_id: string, role: string) {
  return db
    .update(workspace_members)
    .set({ member_role: role })
    .where(eq(workspace_members.user_id, user_id));
}
