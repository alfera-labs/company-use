import {
  answer_provider_checks,
  setup,
  use_a_fresh_install_waiting_for_setup,
} from '@api/routes/__tests__/install_setup_install';
import { db } from '@api/routes/__tests__/team_mode_install';
import { install_connections } from '@coworker/core/db/schema';
import { describe, expect, it } from 'vitest';

use_a_fresh_install_waiting_for_setup();

const openrouter_key = `sk-or-v1-${'r'.repeat(40)}`;

describe('a key pasted for the provider the person chose', () => {
  it('names the other provider when the key clearly belongs to it, and saves nothing', async () => {
    const answer = await setup('ai-key', { api_key: openrouter_key, provider_slot: 'anthropic' });
    expect(answer.status).toBe(409);
    expect(answer.error?.code).toBe('model_key_is_for_another_provider');
    expect(answer.error?.message).toBe('This key looks like it is from OpenRouter, not Anthropic.');
    expect(await db.select().from(install_connections)).toEqual([]);
  });

  it('saves the key under the provider named in the one-click switch', async () => {
    answer_provider_checks({ 'openrouter.ai': 200 });
    const answer = await setup('ai-key', { api_key: openrouter_key, provider_slot: 'openrouter' });
    expect(answer.data).toMatchObject({ provider_slot: 'openrouter', secret_hint: 'rrrr' });
  });

  it('lets the chosen provider decide when several providers share the start of the key', async () => {
    answer_provider_checks({ 'api.deepseek.com': 200 });
    const answer = await setup('ai-key', {
      api_key: `sk-${'d'.repeat(40)}`,
      provider_slot: 'deepseek',
    });
    expect(answer.data).toMatchObject({ provider_slot: 'deepseek' });
  });
});
