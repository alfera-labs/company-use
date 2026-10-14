import { clear_model_catalog_cache, list_models } from '@api/services/models/model_catalog';
import { env } from '@coworker/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const every_model_credential = ['VERCEL_AI_GATEWAY_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
const one_year_ms = 365 * 24 * 60 * 60 * 1000;

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

describe('current models only', () => {
  it('offers no model released more than a year ago', async () => {
    const models = await list_models();
    const stale = models
      .filter(
        (model) => model.release_date && Date.parse(model.release_date) < Date.now() - one_year_ms,
      )
      .map((model) => `${model.model_proxy}/${model.model_id} (${model.release_date})`);

    expect(models.length).toBeGreaterThan(50);
    expect(stale).toEqual([]);
  });

  it('offers the latest Claude and GPT generations', async () => {
    const ids = new Set((await list_models()).map((model) => model.model_id));
    expect(ids.has('claude-fable-5-1')).toBe(true);
    expect(ids.has('gpt-6-luna')).toBe(true);
    expect(ids.has('gpt-4o')).toBe(false);
  });
});

function set_model_key(name: string, value: string | undefined) {
  Object.defineProperty(env, name, { value, writable: true, configurable: true });
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
