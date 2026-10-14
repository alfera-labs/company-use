import { createHash } from 'node:crypto';
import { create_app } from '@api/app';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { read_model_provider_account_values } from '@coworker/core/db/queries/model_provider_accounts';
import { workspaces } from '@coworker/core/db/schema';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const issued_client_id = 'oaiapp_zqtest';
const plan_access_token = 'zq-test-plan-access-token';
const self_hosted_in_tests = env.COWORKER_SELF_HOSTED;
let signing_key: CryptoKey;
let public_jwk: Record<string, unknown>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signing_key = pair.privateKey;
  public_jwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', kid: 'zq-test-key' };
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(env, { COWORKER_SELF_HOSTED: self_hosted_in_tests });
});

type Started = { authorize_url: string; sign_in_attempt: string };

function sign_id_token(nonce: string) {
  return new SignJWT({ nonce, email: 'zq-test@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'zq-test-key' })
    .setIssuer('https://auth.openai.com')
    .setAudience(issued_client_id)
    .setSubject('zq-test-subject')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(signing_key);
}

function openai_answers(input: { granted_scope: string; authorize_url: () => URL }) {
  const token_requests: URLSearchParams[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request | string | URL, init?: RequestInit) => {
      const url = request instanceof Request ? request.url : String(request);
      if (url.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [public_jwk] });
      if (url === 'https://auth.openai.com/api/accounts/oauth/token') {
        token_requests.push(new URLSearchParams(String(init?.body)));
        const nonce = input.authorize_url().searchParams.get('nonce') ?? '';
        return Response.json({
          access_token: plan_access_token,
          refresh_token: 'zq-test-refresh-token',
          id_token: await sign_id_token(nonce),
          expires_in: 3600,
          scope: input.granted_scope,
        });
      }
      if (url === 'https://api.openai.com/v1/models') {
        return Response.json({
          models: [
            { slug: 'gpt-5.5', visibility: 'list' },
            { slug: 'gpt-5.4-mini', visibility: 'hide' },
          ],
        });
      }
      return new Response('down', { status: 503 });
    }),
  );
  return token_requests;
}

async function self_hosted_app(self_hosted = true) {
  Object.assign(env, { COWORKER_SELF_HOSTED: self_hosted });
  const db = await create_test_database();
  return { db, app: create_app(db) };
}

async function start(app: ReturnType<typeof create_app>) {
  const response = await app.request('/v1/workspace/model-provider-accounts/chatgpt/sign-in', {
    method: 'POST',
  });
  return { response, body: await response.json() };
}

function finish(app: ReturnType<typeof create_app>, sign_in_attempt: string, callback_url: string) {
  return app.request('/v1/workspace/model-provider-accounts/chatgpt/sign-in/finish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sign_in_attempt, callback_url }),
  });
}

function pasted_address(started: Started, overrides: Record<string, string> = {}) {
  const state = new URL(started.authorize_url).searchParams.get('state') ?? '';
  const query = new URLSearchParams({ code: 'zq-test-code', state, client_id: issued_client_id });
  for (const [name, value] of Object.entries(overrides)) query.set(name, value);
  return `http://127.0.0.1:1455/auth/callback?${query}`;
}

async function stored_values(db: Database) {
  const [workspace] = await db.select({ workspace_id: workspaces.workspace_id }).from(workspaces);
  return read_model_provider_account_values(db, workspace?.workspace_id ?? '');
}

const full_scope = 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke';

describe('connecting a ChatGPT plan on a self-hosted install', () => {
  it('signs in from the pasted address and offers only the models the plan lists', async () => {
    const { db, app } = await self_hosted_app();
    const { body: started } = await start(app);
    const authorize_url = new URL(started.data.authorize_url);
    const token_requests = openai_answers({
      granted_scope: full_scope,
      authorize_url: () => authorize_url,
    });

    const response = await finish(app, started.data.sign_in_attempt, pasted_address(started.data));
    const body = await response.json();

    expect(Object.fromEntries(authorize_url.searchParams)).toMatchObject({
      client_id: 'dynamic_agent_client',
      agent_name_hint: 'Alfera',
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      resource: 'https://api.openai.com/v1',
      code_challenge_method: 'S256',
      ext_agent_host_id: expect.stringMatching(/^urn:uuid:[0-9a-f-]{36}$/u),
    });
    expect(authorize_url.searchParams.get('scope')?.split(' ')).toContain(
      'chatgpt.tokens.use.direct',
    );
    const [token_request] = token_requests;
    const verifier = token_request?.get('code_verifier') ?? '';
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      authorize_url.searchParams.get('code_challenge'),
    );
    expect(token_request?.get('client_id')).toBe(issued_client_id);
    expect(response.status).toBe(200);
    expect(body.data.provider).toMatchObject({
      provider_slot: 'chatgpt_plan',
      display_name: 'ChatGPT',
    });
    const plan_models = body.data.models.filter(
      (m: { model_proxy: string }) => m.model_proxy === 'chatgpt_plan',
    );
    expect(plan_models.map((m: { model_id: string }) => m.model_id)).toEqual(['gpt-5.5']);
    expect(JSON.stringify(body)).not.toContain(plan_access_token);
    expect(await stored_values(db)).toEqual({
      CHATGPT_PLAN_ACCESS_TOKEN: plan_access_token,
      CHATGPT_PLAN_MODEL_IDS: 'gpt-5.5',
    });
  });

  it.each([
    ['the person said no', { error: 'access_denied' }, 400, 'chatgpt_sign_in_cancelled'],
    [
      'the address is from another sign-in',
      { state: 'zq-test-other' },
      400,
      'chatgpt_sign_in_failed',
    ],
  ])('stores nothing when %s', async (_case, overrides, status, code) => {
    const { db, app } = await self_hosted_app();
    const { body: started } = await start(app);
    const authorize_url = new URL(started.data.authorize_url);
    const token_requests = openai_answers({
      granted_scope: full_scope,
      authorize_url: () => authorize_url,
    });

    const response = await finish(
      app,
      started.data.sign_in_attempt,
      pasted_address(started.data, overrides),
    );

    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(token_requests).toEqual([]);
    expect(await stored_values(db)).toEqual({});
  });

  it('stores nothing when the account did not share its plan', async () => {
    const { db, app } = await self_hosted_app();
    const { body: started } = await start(app);
    const authorize_url = new URL(started.data.authorize_url);
    openai_answers({ granted_scope: 'email openid profile', authorize_url: () => authorize_url });

    const response = await finish(app, started.data.sign_in_attempt, pasted_address(started.data));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('chatgpt_plan_not_shared');
    expect(await stored_values(db)).toEqual({});
  });

  it('is not offered by the hosted product', async () => {
    const { app } = await self_hosted_app(false);

    const { response, body } = await start(app);

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('chatgpt_plan_not_offered_here');
  });
});
