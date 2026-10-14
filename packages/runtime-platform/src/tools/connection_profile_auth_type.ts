import type { RuntimeToolConnectionProfile } from '@runtime-platform/tools/types';

export function auth_type_for_connection_profile(
  profile: RuntimeToolConnectionProfile,
): 'api_key' | 'oauth2' {
  if (profile.setup_strategy.type === 'manual_credentials') return 'api_key';
  if (profile.auth_method_key.endsWith('_bot_token')) return 'api_key';
  return 'oauth2';
}
