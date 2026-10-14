import { describe, expect, it } from 'vitest';
import {
  api_key_providers,
  credential_state,
  find_api_key_account,
  find_api_key_provider,
  find_chatgpt_account,
  masked_secret_hint,
  other_active_accounts_remain,
} from '@/components/app/ai_account_rows';
import type { ModelProviderAccount } from '@/lib/api';

function account(overrides: Partial<ModelProviderAccount> = {}): ModelProviderAccount {
  return {
    provider_slot: 'openai',
    display_name: 'OpenAI',
    secret_hint: '1234',
    credential_status: 'active',
    last_validated_time: null,
    error_message: null,
    ...overrides,
  };
}

describe('the two rows of the AI account screen', () => {
  it('offers a key for OpenAI, Claude and the gateway, in that order', () => {
    expect(api_key_providers.map((provider) => provider.slot)).toEqual([
      'openai',
      'anthropic',
      'vercel_ai_gateway',
    ]);
  });

  it('separates a missing account from a credential that stopped working', () => {
    expect(credential_state(undefined)).toBe('disconnected');
    expect(credential_state(account())).toBe('connected');
    expect(credential_state(account({ credential_status: 'invalid' }))).toBe('invalid');
  });

  it('gives each row only its own credential', () => {
    const signed_in = account({ provider_slot: 'chatgpt', display_name: 'ChatGPT' });
    const pasted = account({ provider_slot: 'anthropic', display_name: 'Anthropic' });

    expect(find_chatgpt_account([signed_in, pasted])).toBe(signed_in);
    expect(find_api_key_account([signed_in, pasted])).toBe(pasted);
    expect(find_chatgpt_account([pasted])).toBeUndefined();
    expect(find_api_key_account([signed_in])).toBeUndefined();
  });

  it('shows the working key when the workspace holds more than one', () => {
    const refused = account({ credential_status: 'invalid' });
    const working = account({ provider_slot: 'vercel_ai_gateway', display_name: 'AI Gateway' });

    expect(find_api_key_account([refused, working])).toBe(working);
    expect(find_api_key_account([refused])).toBe(refused);
    expect(find_api_key_account([])).toBeUndefined();
  });

  it('finds the mark to draw beside a connected key', () => {
    expect(find_api_key_provider(account({ provider_slot: 'anthropic' }))?.label).toBe('Claude');
    expect(find_api_key_provider(undefined)).toBeUndefined();
  });

  it('masks the hint to one shape however long it arrives', () => {
    expect(masked_secret_hint('1234')).toBe('••••1234');
    expect(masked_secret_hint('sk-proj-abcd1234')).toBe('••••1234');
  });
});

describe('who is paying, for the whole workspace', () => {
  it('sees another active account only when a different slot is still working', () => {
    const openai = account({ provider_slot: 'openai' });
    const chatgpt = account({ provider_slot: 'chatgpt' });
    const refused = account({ provider_slot: 'chatgpt', credential_status: 'invalid' });

    expect(other_active_accounts_remain([openai, chatgpt], openai)).toBe(true);
    expect(other_active_accounts_remain([openai], openai)).toBe(false);
    expect(other_active_accounts_remain([openai, refused], openai)).toBe(false);
  });
});
