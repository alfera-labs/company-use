import { clear_model_catalog_cache } from '@api/services/models/model_catalog';
import { list_models_for_the_picker } from '@api/services/models/model_picker_catalog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  clear_model_catalog_cache();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

afterEach(() => {
  vi.unstubAllGlobals();
  clear_model_catalog_cache();
});

function list_picker_models(keys: Record<string, string>, self_hosted = 'true') {
  return list_models_for_the_picker({
    environment: { COWORKER_SELF_HOSTED: self_hosted, ...keys },
  });
}

function keys_of(models: Awaited<ReturnType<typeof list_picker_models>>, model_provider: string) {
  return [
    ...new Set(
      models
        .filter((model) => model.model_provider === model_provider)
        .map((model) =>
          model.keys_that_unlock_this_model.map((key) => key.provider_slot).join('+'),
        ),
    ),
  ];
}

describe('the models a self-hosted picker lists', () => {
  it('lists every provider with only an Anthropic key, and names the key each one needs', async () => {
    const models = await list_picker_models({ ANTHROPIC_API_KEY: 'test_key' });

    expect(keys_of(models, 'anthropic')).toEqual(['']);
    expect(keys_of(models, 'openai')).toContain('openai+openrouter');
    expect(keys_of(models, 'xai')).toContain('xai+openrouter');
    expect(keys_of(models, 'moonshotai')).toContain('moonshotai+openrouter');
    expect(keys_of(models, 'meta')).toContain('openrouter');
    expect(new Set(models.map((model) => model.model_provider)).size).toBeGreaterThan(20);
  });

  it('runs every model OpenRouter lists on one OpenRouter key, grouped under its maker', async () => {
    const models = await list_picker_models({ OPENROUTER_API_KEY: 'test_key' });
    const usable = models.filter((model) => model.keys_that_unlock_this_model.length === 0);
    const usable_providers = new Set(usable.map((model) => model.model_provider));

    expect(usable_providers).toContain('anthropic');
    expect(usable_providers).toContain('xai');
    expect(usable_providers).not.toContain('x-ai');
    expect(usable.every((model) => model.model_proxy === 'openrouter')).toBe(true);
    expect(keys_of(models, 'anthropic')).toEqual(['']);
    expect(keys_of(models, 'groq')).toEqual(['groq']);
  });

  it('lists no model twice', async () => {
    const models = await list_picker_models({ ANTHROPIC_API_KEY: 'test_key' });
    const option_keys = models.map((model) => `${model.model_proxy}:${model.model_id}`);

    expect(option_keys).toEqual([...new Set(option_keys)]);
  });

  it('lists every model with no key yet, so the owner sees what each key unlocks', async () => {
    const models = await list_picker_models({});

    expect(models.length).toBeGreaterThan(100);
    expect(models.every((model) => model.keys_that_unlock_this_model.length > 0)).toBe(true);
  });

  it('lists only usable models on an install that is not self-hosted', async () => {
    const models = await list_picker_models({ ANTHROPIC_API_KEY: 'test_key' }, 'false');

    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.keys_that_unlock_this_model.length === 0)).toBe(true);
  });
});
