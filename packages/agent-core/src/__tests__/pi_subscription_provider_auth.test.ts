import { list_pi_model_ids } from '@agent-core/engines/pi/pi_model';
import { get_pi_models } from '@agent-core/engines/pi/pi_models';
import { describe, expect, it } from 'vitest';

describe('a pi provider that only knows how to log in for itself', () => {
  it('accepts the access token this platform resolved', async () => {
    const auth = await get_pi_models().getAuth('openai-codex', {
      apiKey: 'chatgpt-access-token',
    });

    expect(auth?.auth.apiKey).toBe('chatgpt-access-token');
  });

  it('is still not configured when no token was resolved', async () => {
    expect(await get_pi_models().getAuth('openai-codex')).toBeUndefined();
  });

  it('serves the model the proxy falls back to', () => {
    expect(list_pi_model_ids('openai_codex')).toContain('gpt-5.6-luna');
  });

  it('leaves a provider that already takes a key exactly as pi shipped it', async () => {
    const auth = await get_pi_models().getAuth('openai', { apiKey: 'sk-deployment-key' });

    expect(auth?.auth.apiKey).toBe('sk-deployment-key');
  });
});
