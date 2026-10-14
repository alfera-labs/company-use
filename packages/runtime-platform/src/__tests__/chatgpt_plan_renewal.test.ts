import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { save_model_provider_account_row } from '@coworker/core/db/queries/model_provider_account_rows';
import {
  list_model_provider_accounts,
  read_model_provider_account_values,
} from '@coworker/core/db/queries/model_provider_accounts';
import { read_workspace_chatgpt_plan_values } from '@runtime-platform/chatgpt_plan/chatgpt_plan_renewal';
import { build_workspace_model_environment } from '@runtime-platform/workspace_model_environment';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

function openai_answers(
  token_answer: { status: number; body: unknown },
  before_answer = async () => {},
) {
  const token_requests: URLSearchParams[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (!(init?.signal instanceof AbortSignal))
      throw new Error('a call to OpenAI has no time limit');
    if (String(url).endsWith('/v1/models')) {
      return Response.json({ models: [{ slug: 'gpt-5.5', visibility: 'list' }] });
    }
    token_requests.push(new URLSearchParams(String(init?.body ?? '')));
    await before_answer();
    return Response.json(token_answer.body, { status: token_answer.status });
  });
  return token_requests;
}

const fresh_tokens = {
  status: 200,
  body: {
    access_token: 'zq-test-access-new',
    refresh_token: 'zq-test-refresh-new',
    expires_in: 3600,
  },
};

function save_plan(
  db: Awaited<ReturnType<typeof create_test_database>>,
  workspace_id: string,
  refresh_token: string,
) {
  return save_model_provider_account_row(db, {
    workspace_id,
    provider_slot: 'chatgpt_plan',
    values: {
      CHATGPT_PLAN_ACCESS_TOKEN: 'zq-test-access-other',
      CHATGPT_PLAN_REFRESH_TOKEN: refresh_token,
      CHATGPT_PLAN_EXPIRES_AT: String(Date.now() + 3_600_000),
      CHATGPT_PLAN_CLIENT_ID: 'oaiapp_zqtest',
    },
    metadata: { error_message: null },
    actor_id: 'system:test',
    now: new Date(),
  });
}

async function workspace_with_a_plan(expires_at_ms: number) {
  const db = await create_test_database();
  const { workspace_id, user_id } = await bootstrap_default_workspace(db);
  await save_model_provider_account_row(db, {
    workspace_id,
    provider_slot: 'chatgpt_plan',
    values: {
      CHATGPT_PLAN_ACCESS_TOKEN: 'zq-test-access-old',
      CHATGPT_PLAN_REFRESH_TOKEN: 'zq-test-refresh-old',
      CHATGPT_PLAN_EXPIRES_AT: String(expires_at_ms),
      CHATGPT_PLAN_CLIENT_ID: 'oaiapp_zqtest',
      CHATGPT_PLAN_MODEL_IDS: 'gpt-5.4',
    },
    metadata: { secret_hint: 'test', error_message: null },
    actor_id: user_id,
    now: new Date(),
  });
  return { db, workspace_id };
}

async function plan_status(
  db: Awaited<ReturnType<typeof create_test_database>>,
  workspace_id: string,
) {
  const accounts = await list_model_provider_accounts(db, workspace_id);
  return accounts.find((account) => account.provider_slot === 'chatgpt_plan')?.credential_status;
}

describe('renewing a ChatGPT plan token before a run', () => {
  it('swaps in the rotated tokens and the fresh model list, then stops asking', async () => {
    const { db, workspace_id } = await workspace_with_a_plan(Date.now() - 1000);
    const token_requests = openai_answers({
      status: 200,
      body: {
        access_token: 'zq-test-access-new',
        refresh_token: 'zq-test-refresh-new',
        expires_in: 3600,
      },
    });

    const first = await build_workspace_model_environment(db, workspace_id, {});
    await build_workspace_model_environment(db, workspace_id, {});

    expect(token_requests).toHaveLength(1);
    expect(Object.fromEntries(token_requests[0] ?? [])).toMatchObject({
      grant_type: 'refresh_token',
      client_id: 'oaiapp_zqtest',
      refresh_token: 'zq-test-refresh-old',
      resource: 'https://api.openai.com/v1',
    });
    expect(first.environment).toMatchObject({
      CHATGPT_PLAN_ACCESS_TOKEN: 'zq-test-access-new',
      CHATGPT_PLAN_MODEL_IDS: 'gpt-5.5',
    });
  });

  it('keeps the account when ChatGPT is busy, so the next run tries again', async () => {
    const { db, workspace_id } = await workspace_with_a_plan(Date.now() - 1000);
    openai_answers({ status: 503, body: { error: 'temporarily_unavailable' } });

    const environment = await build_workspace_model_environment(db, workspace_id, {});

    expect(await plan_status(db, workspace_id)).toBe('active');
    expect(environment.environment.CHATGPT_PLAN_ACCESS_TOKEN).toBe('zq-test-access-old');
  });

  it('spends a rotating refresh token once, and every run waits for the new token', async () => {
    const { db, workspace_id } = await workspace_with_a_plan(Date.now() - 1000);
    const token_requests = openai_answers(fresh_tokens);

    const runs = await Promise.all(
      [1, 2, 3].map(() => build_workspace_model_environment(db, workspace_id, {})),
    );

    expect(token_requests).toHaveLength(1);
    for (const run of runs) {
      expect(run.environment.CHATGPT_PLAN_ACCESS_TOKEN).toBe('zq-test-access-new');
    }
  });

  it('holds no lock while it waits on OpenAI, and keeps a sign-in saved meanwhile', async () => {
    const { db, workspace_id } = await workspace_with_a_plan(Date.now() - 1000);
    openai_answers(fresh_tokens, () => save_plan(db, workspace_id, 'zq-test-refresh-reconnect'));

    await build_workspace_model_environment(db, workspace_id, {});

    const values = await read_workspace_chatgpt_plan_values(db, workspace_id);
    expect(values?.CHATGPT_PLAN_REFRESH_TOKEN).toBe('zq-test-refresh-reconnect');
  });

  it('keeps the account when a refresh fails after another refresh succeeded', async () => {
    const { db, workspace_id } = await workspace_with_a_plan(Date.now() - 1000);
    openai_answers({ status: 400, body: { error: 'refresh_token_reused' } }, () =>
      save_plan(db, workspace_id, 'zq-test-refresh-from-the-other-run'),
    );

    await build_workspace_model_environment(db, workspace_id, {});

    expect(await plan_status(db, workspace_id)).toBe('active');
    const values = await read_workspace_chatgpt_plan_values(db, workspace_id);
    expect(values?.CHATGPT_PLAN_REFRESH_TOKEN).toBe('zq-test-refresh-from-the-other-run');
  });

  it('retires the account when ChatGPT says the sign-in is over', async () => {
    const { db, workspace_id } = await workspace_with_a_plan(Date.now() - 1000);
    openai_answers({ status: 400, body: { error: 'invalid_grant' } });

    await build_workspace_model_environment(db, workspace_id, {});

    expect(await plan_status(db, workspace_id)).toBe('invalid');
    expect(await read_model_provider_account_values(db, workspace_id)).toEqual({});
  });
});
