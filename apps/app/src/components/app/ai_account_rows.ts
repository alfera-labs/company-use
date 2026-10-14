import type { ModelProviderAccount, ModelProviderSlot } from '@/lib/api';

export type ApiKeyProvider = {
  slot: ModelProviderSlot;
  label: string;
  logo: string;
  placeholder: string;
};

export const api_key_providers: readonly ApiKeyProvider[] = [
  { slot: 'openai', label: 'OpenAI', logo: '/logos/openai.png', placeholder: 'sk-' },
  { slot: 'anthropic', label: 'Claude', logo: '/logos/claude.png', placeholder: 'sk-ant-' },
  { slot: 'vercel_ai_gateway', label: 'Gateway', logo: '/logos/vercel.svg', placeholder: 'vck_' },
];

export const chatgpt_logo = '/logos/openai.png';

export type CredentialState = 'disconnected' | 'connected' | 'invalid';

export function credential_state(account: ModelProviderAccount | undefined): CredentialState {
  if (!account) return 'disconnected';
  return account.credential_status === 'invalid' ? 'invalid' : 'connected';
}

export function find_chatgpt_account(accounts: readonly ModelProviderAccount[] | undefined) {
  return accounts?.find((account) => account.provider_slot === 'chatgpt');
}

export function find_api_key_account(accounts: readonly ModelProviderAccount[] | undefined) {
  const held = api_key_providers.flatMap(
    (provider) => accounts?.filter((account) => account.provider_slot === provider.slot) ?? [],
  );
  return held.find((account) => account.credential_status === 'active') ?? held[0];
}

export function find_api_key_provider(account: ModelProviderAccount | undefined) {
  return api_key_providers.find((provider) => provider.slot === account?.provider_slot);
}

export function other_active_accounts_remain(
  accounts: readonly ModelProviderAccount[] | undefined,
  without: ModelProviderAccount,
) {
  return (
    accounts?.some(
      (account) =>
        account.provider_slot !== without.provider_slot && account.credential_status === 'active',
    ) ?? false
  );
}

export function masked_secret_hint(secret_hint: string) {
  return `••••${secret_hint.slice(-4)}`;
}
