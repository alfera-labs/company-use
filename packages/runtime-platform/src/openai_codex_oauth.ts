import { not_in_this_edition_error } from '@runtime-platform/automations/not_in_this_edition';

export const chatgpt_device_verification_url = '';
export const chatgpt_unreachable_code = 'chatgpt_unreachable';

export type ChatgptDeviceAuthorization = {
  device_auth_id: string;
  user_code: string;
  interval_seconds: number;
  expires_time: string;
};

export type ChatgptTokens = {
  access_token: string;
  refresh_token: string;
  expires_at_ms: number;
  chatgpt_account_id: string;
};

export async function start_chatgpt_device_authorization(): Promise<ChatgptDeviceAuthorization> {
  throw not_in_this_edition_error();
}

export async function find_approved_chatgpt_authorization(
  _device: Pick<ChatgptDeviceAuthorization, 'device_auth_id' | 'user_code'>,
): Promise<ChatgptTokens | null> {
  throw not_in_this_edition_error();
}

export async function refresh_chatgpt_tokens(_refresh_token: string): Promise<ChatgptTokens> {
  throw not_in_this_edition_error();
}
