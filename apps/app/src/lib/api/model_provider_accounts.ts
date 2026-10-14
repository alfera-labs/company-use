import { api_fetch, api_url, read_api_data } from '@/lib/api/client';

export type ModelProviderSlot = 'openai' | 'anthropic' | 'vercel_ai_gateway' | 'chatgpt';

export type ModelProviderAccount = {
  provider_slot: ModelProviderSlot;
  display_name: string;
  secret_hint: string;
  credential_status: 'active' | 'invalid';
  last_validated_time: string | null;
  error_message: string | null;
};

const model_provider_accounts_path = '/v1/workspace/model-provider-accounts';

export type ModelBillingSource = 'own_account' | 'credits';

export type AiAccountsOverview = {
  accounts: ModelProviderAccount[];
  billing_preference: ModelBillingSource;
  billing_source: ModelBillingSource;
};

export async function list_model_provider_accounts(): Promise<AiAccountsOverview> {
  return read_api_data<AiAccountsOverview>(
    await api_fetch(api_url(model_provider_accounts_path), {
      cache: 'no-store',
    }),
    { method: 'GET', path: model_provider_accounts_path },
  );
}

export async function set_model_billing_source(
  source: ModelBillingSource,
): Promise<{ source: ModelBillingSource }> {
  const path = `${model_provider_accounts_path}/billing-source`;
  return read_api_data<{ source: ModelBillingSource }>(
    await api_fetch(api_url(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    }),
    { method: 'PUT', path },
  );
}

export async function connect_model_provider_account(input: {
  provider_slot: ModelProviderSlot;
  api_key: string;
}): Promise<ModelProviderAccount> {
  return read_api_data<ModelProviderAccount>(
    await api_fetch(api_url(`${model_provider_accounts_path}/${input.provider_slot}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: input.api_key }),
    }),
    { method: 'PUT', path: `${model_provider_accounts_path}/${input.provider_slot}` },
  );
}

export type ChatgptSignIn = {
  device_auth_id: string;
  user_code: string;
  claim: string;
  interval_seconds: number;
  expires_time: string;
  verification_url: string;
};

export async function start_chatgpt_sign_in(): Promise<ChatgptSignIn> {
  const path = `${model_provider_accounts_path}/chatgpt/start-connect`;
  return read_api_data<ChatgptSignIn>(await api_fetch(api_url(path), { method: 'POST' }), {
    method: 'POST',
    path,
  });
}

export async function finish_chatgpt_sign_in(input: {
  device_auth_id: string;
  user_code: string;
  claim: string;
}): Promise<{ approved: boolean; account?: ModelProviderAccount }> {
  const path = `${model_provider_accounts_path}/chatgpt/finish-connect`;
  return read_api_data<{ approved: boolean; account?: ModelProviderAccount }>(
    await api_fetch(api_url(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    { method: 'POST', path },
  );
}

export async function disconnect_model_provider_account(
  provider_slot: ModelProviderSlot,
): Promise<{ deleted: boolean }> {
  return read_api_data<{ deleted: boolean }>(
    await api_fetch(api_url(`${model_provider_accounts_path}/${provider_slot}`), {
      method: 'DELETE',
    }),
    { method: 'DELETE', path: `${model_provider_accounts_path}/${provider_slot}` },
  );
}
