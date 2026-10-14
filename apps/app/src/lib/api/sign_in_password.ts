import { api_fetch, api_url, read_api_data } from '@/lib/api/client';

const path = '/v1/sign-in-password';

export const sign_in_password_query_key = ['sign_in_password'] as const;

export async function read_sign_in_password(): Promise<{ has_password: boolean }> {
  return read_api_data<{ has_password: boolean }>(
    await api_fetch(api_url(path), { cache: 'no-store' }),
    { method: 'GET', path },
  );
}

export async function make_new_recovery_code(password: string): Promise<{ recovery_code: string }> {
  const recovery_path = `${path}/recovery-code`;
  return read_api_data<{ recovery_code: string }>(
    await api_fetch(api_url(recovery_path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }),
    { method: 'POST', path: recovery_path },
  );
}
