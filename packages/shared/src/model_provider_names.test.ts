import { require_model_proxy } from '@shared/model_configuration';
import { read_model_provider } from '@shared/model_proxy_record';
import { normalize_model_route } from '@shared/model_route';
import { describe, expect, it } from 'vitest';

describe('model providers a proxy names its own way', () => {
  it('reads the models.dev name of the maker from an OpenRouter model id', () => {
    const openrouter = require_model_proxy('openrouter');

    expect(read_model_provider(openrouter, 'x-ai/grok-4.5')).toBe('xai');
    expect(read_model_provider(openrouter, 'mistralai/mistral-medium-3')).toBe('mistral');
    expect(read_model_provider(openrouter, '~anthropic/claude-sonnet-latest')).toBe('anthropic');
    expect(read_model_provider(openrouter, 'deepseek/deepseek-v4-pro')).toBe('deepseek');
  });

  it('keeps a route saved with the name the proxy writes', () => {
    const saved_before = normalize_model_route({
      model_provider: 'x-ai',
      model_proxy: 'openrouter',
      model_name: 'x-ai/grok-4.5',
    });

    expect(saved_before).toEqual({
      success: true,
      route: { model_provider: 'xai', model_proxy: 'openrouter', model_name: 'x-ai/grok-4.5' },
    });
  });
});
