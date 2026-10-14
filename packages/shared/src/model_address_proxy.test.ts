import {
  find_model_proxy_credential,
  find_model_proxy_for_model_id,
  list_model_names_in_env,
  normalize_model_route,
  require_model_proxy,
  resolve_model_profile,
} from '@shared/index';
import { describe, expect, it } from 'vitest';

const address = 'http://host.docker.internal:11434/v1';
const self_hosted_with_own_model = {
  COWORKER_SELF_HOSTED: 'true',
  OPENAI_COMPATIBLE_BASE_URL: address,
  OPENAI_COMPATIBLE_MODEL: 'qwen3:14b',
};

describe('the model address of a self-hosted install', () => {
  it('is configured by the address alone, because a server on the same machine needs no key', () => {
    expect(find_model_proxy_credential('openai_compatible', self_hosted_with_own_model)).toEqual({
      api_key: 'no-key',
      env_name: 'OPENAI_COMPATIBLE_API_KEY',
    });
  });

  it('sends the key when the operator set one', () => {
    expect(
      find_model_proxy_credential('openai_compatible', {
        ...self_hosted_with_own_model,
        OPENAI_COMPATIBLE_API_KEY: 'key-of-the-server',
      }),
    ).toEqual({ api_key: 'key-of-the-server', env_name: 'OPENAI_COMPATIBLE_API_KEY' });
  });

  it('is not configured without an address, even with a key', () => {
    expect(
      find_model_proxy_credential('openai_compatible', {
        COWORKER_SELF_HOSTED: 'true',
        OPENAI_COMPATIBLE_API_KEY: 'key-of-the-server',
      }),
    ).toBeUndefined();
  });

  it.each([
    undefined,
    'false',
    '0',
    '',
  ])('is never served where the self-host switch is %s', (self_hosted) => {
    expect(
      find_model_proxy_credential('openai_compatible', {
        ...self_hosted_with_own_model,
        OPENAI_COMPATIBLE_API_KEY: 'key-of-the-server',
        COWORKER_SELF_HOSTED: self_hosted,
      }),
    ).toBeUndefined();
  });

  it('reads the switch as the config package parses it, too', () => {
    expect(
      find_model_proxy_credential('openai_compatible', {
        ...self_hosted_with_own_model,
        COWORKER_SELF_HOSTED: true,
      }),
    ).toBeDefined();
  });

  it('claims no model id, so every id still routes where it did', () => {
    expect(find_model_proxy_for_model_id('zai/glm-4.6')?.model_proxy).toBe('vercel_ai_gateway');
    expect(find_model_proxy_for_model_id('qwen3:14b')?.model_proxy).toBe('openai_direct');
    expect(find_model_proxy_for_model_id('claude-sonnet-5')?.model_proxy).toBe('anthropic_direct');
    expect(
      find_model_proxy_for_model_id('meta-llama/Llama-3.1-8B-Instruct', [
        require_model_proxy('openai_compatible'),
        require_model_proxy('vercel_ai_gateway'),
      ])?.model_proxy,
    ).toBe('vercel_ai_gateway');
  });

  it('takes any model name when a request names this proxy', () => {
    for (const model_name of ['qwen3:14b', 'meta-llama/Llama-3.1-8B-Instruct']) {
      expect(normalize_model_route({ model_proxy: 'openai_compatible', model_name })).toEqual({
        success: true,
        route: {
          model_provider: 'openai_compatible',
          model_proxy: 'openai_compatible',
          model_name,
        },
      });
    }
  });

  it('lists the model names the operator wrote, the agent-run one first', () => {
    expect(
      list_model_names_in_env(require_model_proxy('openai_compatible'), {
        OPENAI_COMPATIBLE_SESSION_TITLE_MODEL: 'qwen3:4b',
        OPENAI_COMPATIBLE_MODEL: ' qwen3:14b ',
        OPENAI_COMPATIBLE_CLASSIFICATION_MODEL: 'qwen3:4b',
        OPENAI_MODEL: 'gpt-5.5',
      }),
    ).toEqual(['qwen3:14b', 'qwen3:4b']);
  });

  it('gives a new workspace the operator model, not a default name no server has', () => {
    expect(resolve_model_profile('customer_agent', self_hosted_with_own_model)).toEqual({
      model_provider: 'openai_compatible',
      model_proxy: 'openai_compatible',
      model_name: 'qwen3:14b',
      reasoning_level: 'high',
    });
  });

  it('leaves the profile of the hosted product as it was', () => {
    expect(
      resolve_model_profile('customer_agent', {
        ...self_hosted_with_own_model,
        COWORKER_SELF_HOSTED: 'false',
        OPENAI_API_KEY: 'openai-key',
      }),
    ).toMatchObject({ model_proxy: 'openai_direct', model_name: 'gpt-6-luna' });
  });
});
