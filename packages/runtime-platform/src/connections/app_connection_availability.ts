import { list_env_names_with_no_value } from '@coworker/config/connector_oauth_clients';
import type {
  AppMetadataData,
  ConnectionProfileData,
} from '@coworker/core/db/schema/json_column_types';
import { parse_app_provider_configs } from '@coworker/core/integrations/app_provider_configs';
import { composio_is_configured } from '@runtime-platform/composio/composio_client';
import { z } from 'zod';

export type AppToConnect = {
  app_display_name: string;
  auth_type?: string | null;
  metadata: AppMetadataData;
};

type ProfileOfProvider = { provider_key: string; profile: ConnectionProfileData };

/**
 * Why this deployment cannot connect the app, in one sentence a person can act on. Null when it
 * can. An app with no provider config at all connects the old way and is not judged here, except
 * a built-in app that needs no account: a setup for it could never finish.
 */
export function find_why_app_cannot_connect_here(app: AppToConnect): string | null {
  const active_configs = parse_app_provider_configs(app.metadata).filter(
    (config) => config.status === 'active',
  );
  if (active_configs.length === 0) {
    return is_built_in_with_no_account(app)
      ? `${app.app_display_name} is built in: there is no account to connect.`
      : null;
  }

  const profiles = active_configs.flatMap((config) =>
    config.connection_profiles
      .filter((profile) => profile.status === 'active')
      .map((profile): ProfileOfProvider => ({ provider_key: config.provider_key, profile })),
  );
  const reasons = profiles.map(find_what_the_profile_lacks);
  if (reasons.includes(null)) return null;

  const what_is_missing = reasons[0] ?? 'it has no way to connect an account';
  return `${app.app_display_name} is not set up on this deployment: ${what_is_missing}.`;
}

const native_app_source_schema = z.object({ provider: z.literal('native') });

function is_built_in_with_no_account(app: AppToConnect) {
  const is_native = native_app_source_schema.safeParse(app.metadata.sourced_from).success;
  return app.auth_type === 'none' && is_native;
}

function find_what_the_profile_lacks({ provider_key, profile }: ProfileOfProvider): string | null {
  if (provider_key === 'composio') {
    return composio_is_configured() ? null : 'the app catalogue key (COMPOSIO_API_KEY) is missing';
  }
  if (provider_key === 'native' && profile.auth_method_key === 'api_key') {
    return 'it connects with an API key, and there is no place to enter that key yet';
  }
  if (profile.setup_strategy.type !== 'oauth2_authorization_code') return null;
  if (typeof profile.setup_strategy.client_id === 'string') return null;

  const names_the_profile_reads = [
    profile.setup_strategy.client_id_env,
    ...(profile.setup_strategy.token_auth_method === 'none'
      ? []
      : [profile.setup_strategy.client_secret_env]),
  ].filter((name) => typeof name === 'string');
  const missing_names = list_env_names_with_no_value(names_the_profile_reads);
  return missing_names.length === 0
    ? null
    : `its OAuth client (${missing_names.join(' and ')}) is missing`;
}
