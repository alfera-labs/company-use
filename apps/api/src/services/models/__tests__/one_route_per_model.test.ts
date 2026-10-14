import { clear_model_catalog_cache, list_models } from '@api/services/models/model_catalog';
import { env } from '@coworker/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const every_model_credential = [
  'VERCEL_AI_GATEWAY_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
] as const;

beforeEach(() => {
  clear_model_catalog_cache();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  for (const credential of every_model_credential) set_model_key(credential, 'test_key');
});

afterEach(() => {
  for (const credential of every_model_credential) set_model_key(credential, undefined);
  vi.unstubAllGlobals();
  clear_model_catalog_cache();
});

describe('one route per model', () => {
  it('offers every model provider through exactly one proxy', async () => {
    const models = await list_models();
    const proxies_by_provider = new Map<string, Set<string>>();

    for (const model of models) {
      const proxies = proxies_by_provider.get(model.model_provider) ?? new Set<string>();
      proxies.add(model.model_proxy);
      proxies_by_provider.set(model.model_provider, proxies);
    }

    const model_providers_offered_through_several_proxies = [...proxies_by_provider.entries()]
      .filter(([, proxies]) => proxies.size > 1)
      .map(([model_provider, proxies]) => `${model_provider}: ${[...proxies].join(', ')}`);

    expect(models.length).toBeGreaterThan(0);
    expect(model_providers_offered_through_several_proxies).toEqual([]);
  });

  it('routes Anthropic and OpenAI through the proxies we manage directly', async () => {
    const models = await list_models();
    const proxy_for = (model_provider: string) => [
      ...new Set(
        models
          .filter((model) => model.model_provider === model_provider)
          .map((model) => model.model_proxy),
      ),
    ];

    expect(proxy_for('anthropic')).toEqual(['anthropic_direct']);
    expect(proxy_for('openai')).toEqual(['openai_direct']);
  });

  it('lists no model id twice', async () => {
    const models = await list_models();
    const model_ids = models.map((model) => model.model_id);

    expect(model_ids).toEqual([...new Set(model_ids)]);
  });
});

function set_model_key(name: string, value: string | undefined) {
  Object.defineProperty(env, name, { value, writable: true, configurable: true });
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
