import type { first_connection_profile } from '@/lib/catalog_app';

export type ConnectionSetupStartRequest = {
  connection_id?: string | undefined;
  setup_token?: string | undefined;
  app_name?: string | undefined;
  provider_key?: string | undefined;
  provider_config_key?: string | undefined;
  connection_profile_key?: string | undefined;
  connection_name?: string | undefined;
};

export function connection_setup_request(
  search_params: Record<string, unknown>,
): ConnectionSetupStartRequest {
  return {
    connection_id: read_search_param(search_params, 'connection_id'),
    setup_token: read_search_param(search_params, 'setup_token'),
    app_name: read_search_param(search_params, 'app_name'),
    provider_key: read_search_param(search_params, 'provider_key'),
    provider_config_key: read_search_param(search_params, 'provider_config_key'),
    connection_profile_key: read_search_param(search_params, 'connection_profile_key'),
    connection_name: read_search_param(search_params, 'connection_name'),
  };
}

export function connection_profile_request(
  request: ConnectionSetupStartRequest,
  profile: NonNullable<ReturnType<typeof first_connection_profile>>,
) {
  const provider_key = request.provider_key ?? profile.provider_key;
  const provider_config_key = request.provider_config_key ?? profile.provider_config_key;
  const connection_profile_key = request.connection_profile_key ?? profile.connection_profile_key;

  return {
    ...(provider_key ? { provider_key } : {}),
    ...(provider_config_key ? { provider_config_key } : {}),
    ...(connection_profile_key ? { connection_profile_key } : {}),
  };
}

function read_search_param(search_params: Record<string, unknown>, key: string) {
  const value = search_params[key];
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
}
