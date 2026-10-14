import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { write_model_billing_preference } from '@coworker/core/db/queries/model_billing_source';
import {
  mark_model_provider_account_invalid,
  upsert_model_provider_account,
} from '@coworker/core/db/queries/model_provider_accounts';
import { connections } from '@coworker/core/db/schema';
import { build_workspace_model_environment } from '@runtime-platform/workspace_model_environment';
import { describe, expect, it } from 'vitest';

async function workspace_bringing_its_own_openai_key() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await upsert_model_provider_account(db, {
    workspace_id: bootstrap.workspace_id,
    provider_slot: 'openai',
    api_key: 'sk-workspace-key',
    actor_id: bootstrap.user_id,
  });
  return { db, workspace_id: bootstrap.workspace_id, user_id: bootstrap.user_id };
}

describe('the environment a workspace resolves its model against', () => {
  it('withholds a connected key from a workspace that chose to bill credits', async () => {
    const { db, workspace_id, user_id } = await workspace_bringing_its_own_openai_key();
    await write_model_billing_preference(db, {
      workspace_id,
      source: 'credits',
      actor_id: user_id,
    });

    const overlay = await build_workspace_model_environment(db, workspace_id, {
      OPENAI_API_KEY: 'sk-deployment-key',
    });

    expect(overlay.environment.OPENAI_API_KEY).toBe('sk-deployment-key');
    expect(overlay.workspace_owned_env_names.size).toBe(0);
  });

  it('restores the connected key when the workspace switches back', async () => {
    const { db, workspace_id, user_id } = await workspace_bringing_its_own_openai_key();
    await write_model_billing_preference(db, {
      workspace_id,
      source: 'credits',
      actor_id: user_id,
    });
    await write_model_billing_preference(db, {
      workspace_id,
      source: 'own_account',
      actor_id: user_id,
    });

    const overlay = await build_workspace_model_environment(db, workspace_id, {
      OPENAI_API_KEY: 'sk-deployment-key',
    });

    expect(overlay.environment.OPENAI_API_KEY).toBe('sk-workspace-key');
  });

  it('lays the workspace key over the deployment key and names what it owns', async () => {
    const { db, workspace_id } = await workspace_bringing_its_own_openai_key();

    const overlay = await build_workspace_model_environment(db, workspace_id, {
      OPENAI_API_KEY: 'sk-deployment-key',
      ANTHROPIC_API_KEY: 'sk-deployment-anthropic',
    });

    expect(overlay.environment.OPENAI_API_KEY).toBe('sk-workspace-key');
    expect(overlay.environment.ANTHROPIC_API_KEY).toBe('sk-deployment-anthropic');
    expect([...overlay.workspace_owned_env_names]).toEqual(['OPENAI_API_KEY']);
  });

  it('leaves the deployment environment untouched for a workspace that brought nothing', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const overlay = await build_workspace_model_environment(db, bootstrap.workspace_id, {
      OPENAI_API_KEY: 'sk-deployment-key',
    });

    expect(overlay.environment.OPENAI_API_KEY).toBe('sk-deployment-key');
    expect(overlay.workspace_owned_env_names.size).toBe(0);
  });

  it('excludes a slot the provider already refused', async () => {
    const { db, workspace_id, user_id } = await workspace_bringing_its_own_openai_key();
    await mark_model_provider_account_invalid(db, {
      workspace_id,
      provider_slot: 'openai',
      error_message: 'OpenAI returned 401',
      actor_id: user_id,
    });

    const overlay = await build_workspace_model_environment(db, workspace_id, {
      OPENAI_API_KEY: 'sk-deployment-key',
    });

    expect(overlay.environment.OPENAI_API_KEY).toBe('sk-deployment-key');
    expect(overlay.workspace_owned_env_names.size).toBe(0);
  });

  it('throws a named error rather than falling back when a stored key will not decrypt', async () => {
    const { db, workspace_id } = await workspace_bringing_its_own_openai_key();
    await db.update(connections).set({
      credentials: { encrypted_values: { OPENAI_API_KEY: { corrupted: true } } } as never,
    });

    await expect(
      build_workspace_model_environment(db, workspace_id, { OPENAI_API_KEY: 'sk-deployment-key' }),
    ).rejects.toMatchObject({ code: 'workspace_model_key_unreadable' });
  });
});
