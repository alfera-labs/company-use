import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  get_app_by_name,
  list_apps,
  list_apps_by_normalized_keys,
  search_apps,
} from '@coworker/core/db/queries/catalog';
import { list_workspace_credentials } from '@coworker/core/db/queries/connection_credentials';
import { list_redacted_connections } from '@coworker/core/db/queries/connection_management';
import { find_model_provider_account_row } from '@coworker/core/db/queries/model_provider_account_rows';
import {
  delete_model_provider_account,
  list_model_provider_accounts,
  mark_model_provider_account_invalid,
  read_model_provider_account_values,
  upsert_model_provider_account,
} from '@coworker/core/db/queries/model_provider_accounts';
import { connections } from '@coworker/core/db/schema';
import { describe, expect, it } from 'vitest';

async function workspace_with_openai_key(api_key = 'sk-test-openai-key-0001') {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const account = await upsert_model_provider_account(db, {
    workspace_id: bootstrap.workspace_id,
    provider_slot: 'openai',
    api_key,
    actor_id: bootstrap.user_id,
  });
  return { db, bootstrap, account };
}

describe('workspace model provider accounts', () => {
  it('stores a key encrypted and reads it back under its environment name', async () => {
    const { db, bootstrap } = await workspace_with_openai_key();

    expect(await read_model_provider_account_values(db, bootstrap.workspace_id)).toEqual({
      OPENAI_API_KEY: 'sk-test-openai-key-0001',
    });
    const [row] = await db.select().from(connections);
    expect(JSON.stringify(row?.credentials)).not.toContain('sk-test-openai-key-0001');
  });

  it('replaces the stored key rather than keeping the one it replaced', async () => {
    const { db, bootstrap } = await workspace_with_openai_key();

    await upsert_model_provider_account(db, {
      workspace_id: bootstrap.workspace_id,
      provider_slot: 'openai',
      api_key: 'sk-test-openai-key-0002',
      actor_id: bootstrap.user_id,
    });

    expect(await read_model_provider_account_values(db, bootstrap.workspace_id)).toEqual({
      OPENAI_API_KEY: 'sk-test-openai-key-0002',
    });
    expect(await db.select().from(connections)).toHaveLength(1);
  });

  it('lists an account masked, with only the last four characters of the key', async () => {
    const { db, bootstrap } = await workspace_with_openai_key();

    const accounts = await list_model_provider_accounts(db, bootstrap.workspace_id);

    expect(accounts).toEqual([
      expect.objectContaining({
        provider_slot: 'openai',
        display_name: 'OpenAI',
        secret_hint: '0001',
        credential_status: 'active',
        error_message: null,
      }),
    ]);
    expect(JSON.stringify(accounts)).not.toContain('sk-test-openai-key-0001');
  });

  it('keeps an account the provider refused out of the values a run resolves against', async () => {
    const { db, bootstrap } = await workspace_with_openai_key();

    await mark_model_provider_account_invalid(db, {
      workspace_id: bootstrap.workspace_id,
      provider_slot: 'openai',
      error_message: 'OpenAI returned 401',
      actor_id: bootstrap.user_id,
    });

    expect(await read_model_provider_account_values(db, bootstrap.workspace_id)).toEqual({});
    expect(await list_model_provider_accounts(db, bootstrap.workspace_id)).toEqual([
      expect.objectContaining({
        credential_status: 'invalid',
        error_message: 'OpenAI returned 401',
      }),
    ]);
  });

  it('deletes the account and lets the same slot be connected again', async () => {
    const { db, bootstrap } = await workspace_with_openai_key();

    expect(
      await delete_model_provider_account(db, {
        workspace_id: bootstrap.workspace_id,
        provider_slot: 'openai',
      }),
    ).toBe(true);
    expect(await list_model_provider_accounts(db, bootstrap.workspace_id)).toEqual([]);

    await upsert_model_provider_account(db, {
      workspace_id: bootstrap.workspace_id,
      provider_slot: 'openai',
      api_key: 'sk-test-openai-key-0003',
      actor_id: bootstrap.user_id,
    });
    expect(await read_model_provider_account_values(db, bootstrap.workspace_id)).toEqual({
      OPENAI_API_KEY: 'sk-test-openai-key-0003',
    });
  });

  it('reports nothing to delete when the slot was never connected', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    expect(
      await delete_model_provider_account(db, {
        workspace_id: bootstrap.workspace_id,
        provider_slot: 'anthropic',
      }),
    ).toBe(false);
  });

  it('never appears among the workspace connections or credentials', async () => {
    const { db, bootstrap } = await workspace_with_openai_key();
    const stored_row = await find_model_provider_account_row(db, {
      workspace_id: bootstrap.workspace_id,
      provider_slot: 'openai',
    });
    if (!stored_row) throw new Error('fixture stored no model provider account row');

    const connection_rows = await list_redacted_connections(db, bootstrap.workspace_id);
    const credential_rows = await list_workspace_credentials(db, bootstrap.workspace_id);
    const listed_ids = [...connection_rows, ...credential_rows].map((row) => row.connection_id);
    expect(listed_ids).not.toContain(stored_row.connection_id);
  });

  it('never appears in the app catalog an agent searches', async () => {
    const { db, bootstrap } = await workspace_with_openai_key();
    const workspace_id = bootstrap.workspace_id;

    const listed = await list_apps(db, workspace_id);
    const searched = await search_apps(db, { workspace_id, query: 'model_key' });
    const by_key = await list_apps_by_normalized_keys(db, {
      keys: ['modelkeyopenai'],
      workspace_id,
    });

    expect(listed.map((app) => app.app_name)).not.toContain('model_key_openai');
    expect(searched.items.map((app) => app.app_name)).not.toContain('model_key_openai');
    expect(by_key).toEqual([]);
    expect(await get_app_by_name(db, { workspace_id, app_name: 'model_key_openai' })).toBeNull();
    expect((await list_apps(db)).map((app) => app.app_name)).not.toContain('model_key_openai');
  });
});
