import { env } from '@coworker/config';
import type { RuntimeToolConnectionProfile } from '@runtime-platform/tools/types';

export const native_slack_app_name = 'slack';
export const native_slack_provider_key = 'native';
export const native_slack_provider_config_key = 'native:slack';
export const native_slack_connection_profile_key = 'native:slack:oauth_bot';
const native_slack_auth_method_key = 'slack_oauth2_bot';

const native_slack_bot_scopes = [
  'app_mentions:read',
  'channels:history',
  'channels:join',
  'channels:read',
  'chat:write',
  'chat:write.public',
  'files:write',
  'files:read',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'mpim:write',
  'reactions:write',
  'users:read',
  'users:read.email',
] as const;

export const native_slack_connection_profile: RuntimeToolConnectionProfile = {
  provider_key: native_slack_provider_key,
  provider_config_key: native_slack_provider_config_key,
  connection_profile_key: native_slack_connection_profile_key,
  auth_method_key: native_slack_auth_method_key,
  setup_strategy: {
    type: 'oauth2_authorization_code',
    authorization_url: 'https://slack.com/oauth/v2/authorize',
    token_url: 'https://slack.com/api/oauth.v2.access',
    client_id_env: 'SLACK_CLIENT_ID',
    client_secret_env: 'SLACK_CLIENT_SECRET',
    authorization_params: slack_oauth_authorization_params(),
    use_pkce: false,
    scope_separator: 'comma',
  },
  runtime_credential_strategy: {
    type: 'encrypted_connection_credentials',
    token_field: 'access_token',
  },
  default_scopes: [...native_slack_bot_scopes],
};

function slack_oauth_authorization_params() {
  return env.SLACK_TEAM_ID ? { team: env.SLACK_TEAM_ID } : {};
}
