import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { read_model_provider_account_values } from '@coworker/core/db/queries/model_provider_accounts';
import { workspaces } from '@coworker/core/db/schema';
import { key_shaped_value } from '@coworker/shared/test_support/key_shaped_value';
import { afterEach, describe, expect, it, vi } from 'vitest';

const check_urls = {
  anthropic: 'https://api.anthropic.com/v1/models',
  openai: 'https://api.openai.com/v1/models',
  deepseek: 'https://api.deepseek.com/models',
  mistral: 'https://api.mistral.ai/v1/models',
  vercel_ai_gateway: 'https://ai-gateway.vercel.sh/v1/credits',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function providers_answer(
  status_by_url: Record<string, number>,
  body_by_url: Record<string, string> = {},
) {
  const checked_urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith('https://models.dev/')) return new Response('down', { status: 503 });
      checked_urls.push(url);
      return new Response(body_by_url[url] ?? '{}', { status: status_by_url[url] ?? 401 });
    }),
  );
  return checked_urls;
}

async function paste_key(api_key: string, provider_slot?: string) {
  const db = await create_test_database();
  const response = await create_app(db).request('/v1/workspace/model-provider-accounts/api-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key, provider_slot }),
  });
  return { db, response, body: await response.json() };
}

async function stored_values(db: Database) {
  const [workspace] = await db.select({ workspace_id: workspaces.workspace_id }).from(workspaces);
  return read_model_provider_account_values(db, workspace?.workspace_id ?? '');
}

describe('connecting AI with one pasted key', () => {
  it('reads an Anthropic key by its prefix, checks it with Anthropic alone, and stores it', async () => {
    const checked = providers_answer({ [check_urls.anthropic]: 200 });
    const api_key = key_shaped_value('anthropic', '0123456789abcdef');

    const { db, response, body } = await paste_key(api_key);

    expect(response.status).toBe(200);
    expect(checked).toEqual([check_urls.anthropic]);
    expect(body.data.provider).toEqual({
      provider_slot: 'anthropic',
      display_name: 'Anthropic',
      logo_url: 'https://models.dev/logos/anthropic.svg',
    });
    expect(body.data.account).toMatchObject({ provider_slot: 'anthropic', secret_hint: 'cdef' });
    expect(body.data.models.length).toBeGreaterThan(0);
    expect(body.data.models).toContainEqual(
      expect.objectContaining({ model_proxy: 'anthropic_direct', model_provider: 'anthropic' }),
    );
    expect(JSON.stringify(body)).not.toContain(api_key);
    expect(await stored_values(db)).toEqual({ ANTHROPIC_API_KEY: api_key });
  });

  it('sends a bare sk- key nowhere and asks which company gave it', async () => {
    const checked = providers_answer({ [check_urls.openai]: 200, [check_urls.deepseek]: 200 });

    const { db, response, body } = await paste_key('sk-zqtest0123456789abcdef0123');

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('model_key_fits_several_providers');
    expect(
      body.error.details.candidates.map((c: { provider_slot: string }) => c.provider_slot).sort(),
    ).toEqual(['deepseek', 'openai']);
    expect(checked).toEqual([]);
    expect(await stored_values(db)).toEqual({});
  });

  it('checks a bare sk- key with the one company the person picks', async () => {
    const checked = providers_answer({ [check_urls.openai]: 200, [check_urls.deepseek]: 200 });

    const { db, response, body } = await paste_key('sk-zqtest0123456789abcdef0123', 'deepseek');

    expect(response.status).toBe(200);
    expect(checked).toEqual([check_urls.deepseek]);
    expect(body.data.provider.provider_slot).toBe('deepseek');
    expect(await stored_values(db)).toEqual({ DEEPSEEK_API_KEY: 'sk-zqtest0123456789abcdef0123' });
  });

  it('asks which company gave a key with no known prefix, and sends it nowhere', async () => {
    const checked = providers_answer({ [check_urls.mistral]: 200 });

    const { db, response, body } = await paste_key('zqtest0123456789abcdef0123456789');

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('model_key_needs_provider');
    expect(body.error.details.candidates).toContainEqual({
      provider_slot: 'mistral',
      display_name: 'Mistral',
    });
    expect(checked).toEqual([]);
    expect(await stored_values(db)).toEqual({});
  });

  it('checks a key with no known prefix with the company the person names', async () => {
    const checked = providers_answer({ [check_urls.mistral]: 200 });
    const db = await create_test_database();

    const response = await create_app(db).request('/v1/workspace/model-provider-accounts/api-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: 'zqtest0123456789abcdef0123456789',
        provider_slot: 'mistral',
      }),
    });

    expect(response.status).toBe(200);
    expect(checked).toEqual([check_urls.mistral]);
    expect(await stored_values(db)).toEqual({
      MISTRAL_API_KEY: 'zqtest0123456789abcdef0123456789',
    });
  });

  it.each([
    [
      'a Claude subscription token',
      'sk-ant-oat01-zqtest0123456789',
      'model_key_is_claude_subscription_token',
    ],
    ['an OpenAI admin key', 'sk-admin-zqtest012345', 'model_key_is_admin_key'],
    ['part of a key', 'sk-ant-api03-zq', 'model_key_too_short'],
  ])('refuses %s without sending it anywhere', async (_name, api_key, code) => {
    const checked = providers_answer({});

    const { db, response, body } = await paste_key(api_key);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe(code);
    expect(checked).toEqual([]);
    expect(await stored_values(db)).toEqual({});
  });

  it('says the account has no credit when the provider answers 402', async () => {
    providers_answer({ [check_urls.vercel_ai_gateway]: 402 });

    const { response, body } = await paste_key('vck_zqtest0123456789abcdef0123');

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: 'model_provider_has_no_credit',
      message:
        'AI Gateway accepted the key, but the account has no credit. Add credit, then try again.',
    });
  });

  it('says the account has no credit when the provider answers 429 for an empty quota', async () => {
    const no_quota = '{"error":{"type":"insufficient_quota"}}';
    providers_answer({ [check_urls.anthropic]: 429 }, { [check_urls.anthropic]: no_quota });

    const { response, body } = await paste_key(key_shaped_value('anthropic', '0123456789abcdef'));

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({ code: 'model_provider_has_no_credit' });
  });

  it('stores a key whose provider only answers too many requests right now', async () => {
    providers_answer({ [check_urls.anthropic]: 429 });

    const { response } = await paste_key(key_shaped_value('anthropic', '0123456789abcdef'));

    expect(response.status).toBe(200);
  });

  it('names the provider that refused a key it issued', async () => {
    providers_answer({ [check_urls.anthropic]: 401 });

    const { response, body } = await paste_key(key_shaped_value('anthropic', 'abcdefghij0123'));

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('model_provider_key_rejected');
    expect(body.error.message).toBe('Anthropic refused this key. Make a new key and paste it.');
  });
});
