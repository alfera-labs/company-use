import { get_pi_provider_name } from '@agent-core/engines/pi/pi_model';
import { get_pi_models } from '@agent-core/engines/pi/pi_models';
import { resolve_llm_model } from '@agent-core/llm_gateway/model_resolver';
import { models_dev_catalog_schema } from '@agent-core/llm_gateway/models_dev_schema';
import models_dev_snapshot from '@agent-core/llm_gateway/models_dev_snapshot.json' with {
  type: 'json',
};
import { list_model_proxies } from '@coworker/shared';
import { describe, expect, it } from 'vitest';

describe('models.dev models pi lacks', () => {
  it('registers a models.dev model on the API and base URL of its family sibling', () => {
    const fable_5_1 = get_pi_models().getModel('anthropic', 'claude-fable-5-1');
    const fable_5 = get_pi_models().getModel('anthropic', 'claude-fable-5');

    expect(fable_5_1).toMatchObject({
      id: 'claude-fable-5-1',
      name: 'Claude Fable 5.1',
      api: fable_5?.api,
      baseUrl: fable_5?.baseUrl,
      provider: 'anthropic',
      thinkingLevelMap: fable_5?.thinkingLevelMap,
      contextWindow: 1000000,
    });
    expect(fable_5_1?.cost.input).toBeGreaterThan(0);
  });

  it('keeps every model pi ships', () => {
    expect(get_pi_models().getModel('anthropic', 'claude-fable-5')?.name).toBe('Claude Fable 5');
  });

  it('marks a model the catalogue says takes no temperature, so pi sends it none', () => {
    const takes_none = get_pi_models().getModel('anthropic', 'claude-sonnet-5');
    const takes_one = get_pi_models().getModel('anthropic', 'claude-haiku-4-5');

    expect(takes_none?.compat).toMatchObject({ supportsTemperature: false });
    expect(takes_one?.compat ?? {}).not.toHaveProperty('supportsTemperature', false);
  });

  it.each([
    ['ANTHROPIC_API_KEY'],
    ['OPENAI_API_KEY'],
    ['VERCEL_AI_GATEWAY_API_KEY'],
  ])('names a chat on an install whose only model key is %s', (key_name) => {
    const resolved = resolve_llm_model({ use_case: 'session_title' }, { [key_name]: 'test-key' });
    const pi_model = get_pi_models().getModel(
      get_pi_provider_name(resolved.model_proxy),
      resolved.model_name,
    );
    const proxy = list_model_proxies().find((one) => one.model_proxy === resolved.model_proxy);
    const catalog = models_dev_catalog_schema.parse(models_dev_snapshot);
    const catalog_model =
      catalog[proxy?.models_dev_provider_name ?? '']?.models[resolved.model_name];
    const pi_sends_no_temperature =
      pi_model?.api === 'anthropic-messages' &&
      (pi_model.compat as { supportsTemperature?: boolean })?.supportsTemperature === false;

    expect(pi_model).toBeDefined();
    expect(catalog_model?.temperature !== false || pi_sends_no_temperature).toBe(true);
    expect(resolved.max_output_tokens).toBeGreaterThanOrEqual(64);
  });
});
