import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  list_install_model_provider_accounts,
  read_install_model_provider_account_stored_values,
  save_install_model_provider_account,
} from '@coworker/core/db/queries/install_model_provider_accounts';
import { save_model_provider_account_row } from '@coworker/core/db/queries/model_provider_account_rows';
import { build_workspace_model_environment } from '@runtime-platform/workspace_model_environment';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.stubEnv('COWORKER_AUTH_MODE', 'team');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const expired_values = {
  CHATGPT_PLAN_ACCESS_TOKEN: 'zq-test-access-old',
  CHATGPT_PLAN_REFRESH_TOKEN: 'zq-test-refresh-old',
  CHATGPT_PLAN_EXPIRES_AT: String(Date.now() - 1000),
  CHATGPT_PLAN_CLIENT_ID: 'oaiapp_zqtest',
  CHATGPT_PLAN_MODEL_IDS: 'gpt-5.4',
};

function openai_answers(
  token_answer: { status: number; body: unknown },
  before_answer = async () => {},
) {
  const token_requests: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/v1/models')) {
      return Response.json({ models: [{ slug: 'gpt-5.5', visibility: 'list' }] });
    }
    token_requests.push(String(init?.body ?? ''));
    await before_answer();
    return Response.json(token_answer.body, { status: token_answer.status });
  });
  return token_requests;
}

async function install_with_an_expired_plan() {
  const db = await create_test_database();
  const { workspace_id } = await bootstrap_default_workspace(db);
  await save_install_model_provider_account(db, {
    provider_slot: 'chatgpt_plan',
    values: expired_values,
    actor_id: 'system:test',
  });
  return { db, workspace_id };
}

const fresh_tokens = {
  status: 200,
  body: {
    access_token: 'zq-test-access-new',
    refresh_token: 'zq-test-refresh-new',
    expires_in: 3600,
  },
};

describe('renewing the ChatGPT plan of the whole install before a run', () => {
  it('swaps in the rotated tokens once, and the run uses them', async () => {
    const { db, workspace_id } = await install_with_an_expired_plan();
    const token_requests = openai_answers(fresh_tokens);

    const first = await build_workspace_model_environment(db, workspace_id, {});
    await build_workspace_model_environment(db, workspace_id, {});

    expect(token_requests).toHaveLength(1);
    expect(first.environment.CHATGPT_PLAN_ACCESS_TOKEN).toBe('zq-test-access-new');
  });

  it('keeps what an owner saved while the renewal was waiting on OpenAI', async () => {
    const { db, workspace_id } = await install_with_an_expired_plan();
    openai_answers(fresh_tokens, async () => {
      await save_install_model_provider_account(db, {
        provider_slot: 'chatgpt_plan',
        values: { ...expired_values, CHATGPT_PLAN_REFRESH_TOKEN: 'zq-test-refresh-owner' },
        actor_id: 'system:test',
      });
    });

    await build_workspace_model_environment(db, workspace_id, {});

    const stored = await read_install_model_provider_account_stored_values(db, 'chatgpt_plan');
    expect(stored?.CHATGPT_PLAN_REFRESH_TOKEN).toBe('zq-test-refresh-owner');
  });

  it('spends the install refresh token once, and every run waits for the new token', async () => {
    const { db, workspace_id } = await install_with_an_expired_plan();
    const token_requests = openai_answers(fresh_tokens);

    const runs = await Promise.all(
      [1, 2, 3].map(() => build_workspace_model_environment(db, workspace_id, {})),
    );

    expect(token_requests).toHaveLength(1);
    for (const run of runs) {
      expect(run.environment.CHATGPT_PLAN_ACCESS_TOKEN).toBe('zq-test-access-new');
    }
  });

  it('still runs with the workspace key when ChatGPT is busy for the install', async () => {
    const { db, workspace_id } = await install_with_an_expired_plan();
    await save_model_provider_account_row(db, {
      workspace_id,
      provider_slot: 'anthropic',
      values: { ANTHROPIC_API_KEY: 'zq-test-anthropic-key' },
      metadata: { error_message: null },
      actor_id: 'system:test',
      now: new Date(),
    });
    openai_answers({ status: 503, body: { error: 'temporarily_unavailable' } });

    const model = await build_workspace_model_environment(db, workspace_id, {});

    expect(model.environment.ANTHROPIC_API_KEY).toBe('zq-test-anthropic-key');
    const [plan] = await list_install_model_provider_accounts(db);
    expect(plan?.credential_status).toBe('active');
  });

  it('marks the plan as needing a new sign-in when OpenAI refuses the refresh', async () => {
    const { db, workspace_id } = await install_with_an_expired_plan();
    openai_answers({ status: 400, body: { error: 'invalid_grant' } });

    await build_workspace_model_environment(db, workspace_id, {});

    const [plan] = await list_install_model_provider_accounts(db);
    expect(plan?.credential_status).toBe('invalid');
  });
});
