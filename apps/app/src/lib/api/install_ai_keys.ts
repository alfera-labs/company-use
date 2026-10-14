import { api_fetch, api_url, read_api_data } from '@/lib/api/client';
import type { ModelProviderAccount } from '@/lib/api/model_provider_accounts';

const install_ai_keys_path = '/v1/install/model-provider-accounts';

export const install_ai_keys_query_key = ['install_ai_keys'] as const;

export type InstallAiKey = Omit<ModelProviderAccount, 'provider_slot'> & { provider_slot: string };

export type ChatgptSignInStart = {
  authorize_url: string;
  sign_in_attempt: string;
  expires_time: string;
};

export async function list_install_ai_keys(): Promise<InstallAiKey[]> {
  const data = await read_api_data<{ accounts: InstallAiKey[] }>(
    await api_fetch(api_url(install_ai_keys_path), { cache: 'no-store' }),
    { method: 'GET', path: install_ai_keys_path },
  );
  return data.accounts;
}

async function send_json<T>(method: 'PUT' | 'POST', path: string, body: unknown): Promise<T> {
  return read_api_data<T>(
    await api_fetch(api_url(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { method, path },
  );
}

export class InstallKeyRefused extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: unknown,
  ) {
    super(message);
  }
}

type RefusalBody = { error?: { message?: string; code?: string; details?: unknown } };

export async function save_install_ai_key(input: {
  api_key: string;
  provider_slot: string;
}): Promise<InstallAiKey> {
  const response = await api_fetch(api_url(install_ai_keys_path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (response.status === 409) {
    const { error } = (await response.clone().json()) as RefusalBody;
    throw new InstallKeyRefused(error?.message ?? '', error?.code ?? '', error?.details);
  }
  return read_api_data<InstallAiKey>(response, { method: 'PUT', path: install_ai_keys_path });
}

export function start_install_chatgpt_sign_in(): Promise<ChatgptSignInStart> {
  return send_json('POST', `${install_ai_keys_path}/chatgpt/start`, {});
}

export function finish_install_chatgpt_sign_in(input: {
  sign_in_attempt: string;
  callback_url: string;
}): Promise<InstallAiKey> {
  return send_json('POST', `${install_ai_keys_path}/chatgpt/finish`, input);
}

export async function remove_install_ai_key(provider_slot: string): Promise<void> {
  const path = `${install_ai_keys_path}/${provider_slot}`;
  await read_api_data(await api_fetch(api_url(path), { method: 'DELETE' }), {
    method: 'DELETE',
    path,
  });
}
