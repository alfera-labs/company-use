import { create_app } from '@api/app';
import { selectable_model_billing_sources } from '@coworker/config/plans';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  read_model_provider_account_values,
  upsert_model_provider_account,
} from '@coworker/core/db/queries/model_provider_accounts';
import { workspace_members } from '@coworker/core/db/schema';
import { key_shaped_value } from '@coworker/shared/test_support/key_shaped_value';
import { afterEach, describe, expect, it, vi } from 'vitest';

const json_headers = { 'content-type': 'application/json' };
const a_real_looking_key = key_shaped_value('openai_project', '0123456789abcdefghij');

afterEach(() => {
  vi.unstubAllGlobals();
});

function provider_answers(status: number) {
  const provider_fetch = vi.fn(async () => new Response('{}', { status }));
  vi.stubGlobal('fetch', provider_fetch);
  return provider_fetch;
}

async function app_and_database() {
  const db = await create_test_database();
  return { db, app: create_app(db) };
}

function put_key(app: ReturnType<typeof create_app>, api_key = a_real_looking_key) {
  return app.request('/v1/workspace/model-provider-accounts/openai', {
    method: 'PUT',
    headers: json_headers,
    body: JSON.stringify({ api_key }),
  });
}

async function list_accounts(app: ReturnType<typeof create_app>) {
  const response = await app.request('/v1/workspace/model-provider-accounts');
  return { response, body: await response.json() };
}

describe('workspace model provider accounts', () => {
  it('checks the key with the provider and stores it once it is accepted', async () => {
    const { db, app } = await app_and_database();
    const provider_fetch = provider_answers(200);

    const response = await put_key(app);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      provider_slot: 'openai',
      display_name: 'OpenAI',
      secret_hint: 'ghij',
      credential_status: 'active',
    });
    expect(provider_fetch).toHaveBeenCalledTimes(1);
    expect(await read_model_provider_account_values(db, await only_workspace_id(db))).toEqual({
      OPENAI_API_KEY: a_real_looking_key,
    });
  });

  it('stores nothing when the provider refuses the key, and says who refused it', async () => {
    const { db, app } = await app_and_database();
    provider_answers(401);

    const response = await put_key(app);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({
      code: 'model_provider_key_rejected',
      message: 'OpenAI refused this key. Make a new key and paste it.',
    });
    expect(await read_model_provider_account_values(db, await only_workspace_id(db))).toEqual({});
  });

  it('never returns the key itself, only enough of it to recognise', async () => {
    const { app } = await app_and_database();
    provider_answers(200);
    await put_key(app);

    const { response, body } = await list_accounts(app);

    expect(response.status).toBe(200);
    expect(body.data.accounts).toEqual([
      expect.objectContaining({ provider_slot: 'openai', secret_hint: 'ghij' }),
    ]);
    expect(JSON.stringify(body)).not.toContain(a_real_looking_key);
  });

  it('removes the key on delete and reports nothing to remove the second time', async () => {
    const { db, app } = await app_and_database();
    provider_answers(200);
    await put_key(app);

    const deleted = await app.request('/v1/workspace/model-provider-accounts/openai', {
      method: 'DELETE',
    });
    const deleted_again = await app.request('/v1/workspace/model-provider-accounts/openai', {
      method: 'DELETE',
    });

    expect([deleted.status, deleted_again.status]).toEqual([200, 404]);
    expect(await read_model_provider_account_values(db, await only_workspace_id(db))).toEqual({});
  });

  it('rejects a slot no provider claims', async () => {
    const { app } = await app_and_database();
    provider_answers(200);

    const response = await app.request('/v1/workspace/model-provider-accounts/cohere', {
      method: 'PUT',
      headers: json_headers,
      body: JSON.stringify({ api_key: a_real_looking_key }),
    });

    expect(response.status).toBe(422);
  });

  it('refuses a member who is not an admin', async () => {
    const { db, app } = await app_and_database();
    provider_answers(200);
    await list_accounts(app);
    await db.update(workspace_members).set({ member_role: 'member' });

    const put_response = await put_key(app);
    const delete_response = await app.request('/v1/workspace/model-provider-accounts/openai', {
      method: 'DELETE',
    });

    expect([put_response.status, delete_response.status]).toEqual([403, 403]);
    expect((await put_response.json()).error).toMatchObject({
      code: 'model_provider_account_access_denied',
    });
  });
});

const last_selectable_source = selectable_model_billing_sources.at(-1);

describe('choosing who a run bills', () => {
  it('starts on the default and flips with the toggle', async () => {
    const { app } = await app_and_database();

    const before = await list_accounts(app);
    expect(before.body.data).toMatchObject({
      billing_preference: 'own_account',
      billing_source: 'credits',
    });

    const flipped = await app.request('/v1/workspace/model-provider-accounts/billing-source', {
      method: 'PUT',
      headers: json_headers,
      body: JSON.stringify({ source: last_selectable_source }),
    });
    expect(flipped.status).toBe(200);

    const after = await list_accounts(app);
    expect(after.body.data.billing_preference).toBe(last_selectable_source);
  });

  it('reports own_account only once a working account exists', async () => {
    const { db, app } = await app_and_database();
    await list_accounts(app);
    await upsert_model_provider_account(db, {
      workspace_id: await only_workspace_id(db),
      provider_slot: 'openai',
      api_key: 'sk-test-openai-key-0001',
      actor_id: (await db.query.users.findFirst())?.user_id ?? '',
    });

    const overview = await list_accounts(app);
    expect(overview.body.data.billing_source).toBe('own_account');
  });

  it('refuses the toggle to a member who is not an admin', async () => {
    const { db, app } = await app_and_database();
    await list_accounts(app);
    await db.update(workspace_members).set({ member_role: 'member' });

    const response = await app.request('/v1/workspace/model-provider-accounts/billing-source', {
      method: 'PUT',
      headers: json_headers,
      body: JSON.stringify({ source: last_selectable_source }),
    });
    expect(response.status).toBe(403);
  });
});

async function only_workspace_id(db: Database) {
  const rows = await db.query.workspaces.findMany();
  const workspace_id = rows[0]?.workspace_id;
  if (!workspace_id) throw new Error('the test database has no workspace');
  return workspace_id;
}
