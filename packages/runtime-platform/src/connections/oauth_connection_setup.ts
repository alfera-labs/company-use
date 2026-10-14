import { env } from '@coworker/config';
import { fetch_outside_address } from '@coworker/core/credentials/resolve_host_addresses';
import type {
  ConnectionCredentialData,
  ConnectionSetupStateData,
} from '@coworker/core/db/schema/json_column_types';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import {
  type PublicConnectionSetup,
  redact_connection_setup_state,
} from '@runtime-platform/connections/connection_setup_contract';
import {
  build_oauth_token_request,
  parse_oauth_token_response,
} from '@runtime-platform/connections/oauth_token_response';

type ConnectionSetupState = ConnectionSetupStateData;

export {
  type ProviderConnectionCompletion,
  type PublicConnectionSetup,
  redact_connection_setup_state,
} from '@runtime-platform/connections/connection_setup_contract';
export { build_public_connection_setup } from '@runtime-platform/connections/public_connection_setup';

const token_exchange_timeout_ms = 15_000;

export async function exchange_oauth_code_for_tokens(input: {
  setup_state: ConnectionSetupStateData;
  code: string;
  credentials?: ConnectionCredentialData | null;
}) {
  const setup_state = input.setup_state;
  if (setup_state.type !== 'oauth2_authorization_code') {
    throw new Error('Connection setup is not an OAuth authorization-code setup.');
  }

  const client_id = read_oauth_client_id(setup_state);
  const token_url = setup_state.oauth_token_url?.trim();
  if (!client_id || !token_url) {
    throw new Error('OAuth setup is missing client id or token URL.');
  }

  const client_secret = read_oauth_client_secret(setup_state, input.credentials);
  const token_auth_method = setup_state.oauth_token_auth_method?.trim();
  if (requires_oauth_client_secret(setup_state) && !client_secret) {
    throw new Error(
      `OAuth setup is missing ${oauth_setup_field_label(
        setup_state,
        'oauth_client_secret_env',
        'client secret',
      )}.`,
    );
  }

  const code_verifier = setup_state.oauth_code_verifier?.trim();
  // RFC 8707. The authorize leg already carried this via oauth_authorization_params;
  // an authorization server that binds tokens to a resource rejects the exchange
  // when only one leg names it. Absent for every connector that does not use
  // resource indicators, which is all of them except MCP today.
  const resource = setup_state.oauth_resource?.trim();
  const token_request = build_oauth_token_request({
    parameters: {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: resolve_provider_oauth_redirect_uri(),
      ...(code_verifier ? { code_verifier } : {}),
      ...(resource ? { resource } : {}),
    },
    client_id,
    client_secret,
    token_auth_method,
    token_request_format: setup_state.oauth_token_request_format,
  });

  const response = await fetch_outside_address(token_url, {
    method: 'POST',
    headers: token_request.headers,
    body: token_request.body,
    signal: AbortSignal.timeout(token_exchange_timeout_ms),
  });
  const token_response = await parse_oauth_token_response({
    response,
    provider_app_key: setup_state.provider_app_key,
  });

  return token_response;
}

export function build_public_oauth_setup(
  setup_state: ConnectionSetupState,
  credentials?: ConnectionCredentialData | null,
): PublicConnectionSetup {
  const missing_fields = missing_oauth_setup_fields(setup_state, credentials);
  if (missing_fields.length > 0) {
    return {
      ...redact_connection_setup_state(setup_state),
      setup_error: `OAuth setup is incomplete. Set ${format_list(missing_fields)}.`,
    };
  }

  const client_id = read_oauth_client_id(setup_state);
  const authorization_url = setup_state.oauth_authorization_url?.trim();
  const state = setup_state.oauth_state_token?.trim();
  if (!client_id || !authorization_url || !state) {
    return {
      ...redact_connection_setup_state(setup_state),
      setup_error: 'OAuth setup is incomplete.',
    };
  }

  const url = new URL(authorization_url);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client_id);
  url.searchParams.set('redirect_uri', resolve_provider_oauth_redirect_uri());
  url.searchParams.set('state', state);

  const scopes = setup_state.oauth_scopes ?? [];
  if (scopes.length > 0) {
    url.searchParams.set('scope', scopes.join(read_oauth_scope_separator(setup_state)));
  }

  const code_challenge = setup_state.oauth_code_challenge?.trim();
  if (code_challenge) {
    url.searchParams.set('code_challenge', code_challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  for (const [key, value] of Object.entries(setup_state.oauth_authorization_params ?? {})) {
    if (typeof value === 'string') url.searchParams.set(key, value);
  }

  return {
    ...redact_connection_setup_state(setup_state),
    authorization_url: url.toString(),
    setup_error: null,
  };
}

function missing_oauth_setup_fields(
  setup_state: ConnectionSetupState,
  credentials?: ConnectionCredentialData | null,
) {
  const missing_fields: string[] = [];
  if (!read_oauth_client_id(setup_state)) {
    missing_fields.push(oauth_setup_field_label(setup_state, 'oauth_client_id_env', 'client id'));
  }
  if (
    requires_oauth_client_secret(setup_state) &&
    !read_oauth_client_secret(setup_state, credentials)
  ) {
    missing_fields.push(
      oauth_setup_field_label(setup_state, 'oauth_client_secret_env', 'client secret'),
    );
  }
  if (!setup_state.oauth_authorization_url?.trim()) missing_fields.push('authorization URL');
  if (!setup_state.oauth_token_url?.trim()) missing_fields.push('token URL');
  if (!setup_state.oauth_state_token?.trim()) missing_fields.push('state token');
  return missing_fields;
}

function requires_oauth_client_secret(setup_state: ConnectionSetupState) {
  return setup_state.oauth_token_auth_method?.trim() !== 'none';
}

function oauth_setup_field_label(
  setup_state: ConnectionSetupState,
  env_key_field: 'oauth_client_id_env' | 'oauth_client_secret_env',
  fallback: string,
) {
  const env_key = setup_state[env_key_field]?.trim();
  return env_key ? `${env_key} (${fallback})` : fallback;
}

function format_list(values: string[]) {
  if (values.length <= 1) return values[0] ?? '';
  const head = values.slice(0, -1).join(', ');
  return `${head}, and ${values[values.length - 1]}`;
}

function read_oauth_client_id(setup_state: ConnectionSetupState) {
  return (
    setup_state.oauth_client_id?.trim() ??
    environment_value(setup_state.oauth_client_id_env?.trim())
  );
}

function read_oauth_client_secret(
  setup_state: ConnectionSetupState,
  credentials?: ConnectionCredentialData | null,
) {
  return (
    read_connection_credential_value(credentials ?? null, 'oauth_client_secret') ??
    environment_value(setup_state.oauth_client_secret_env?.trim())
  );
}

export function resolve_provider_oauth_redirect_uri() {
  return `${provider_callback_base_url()}/v1/connections/oauth/callback`;
}

function provider_callback_base_url() {
  return environment_value('API_PUBLIC_URL') ?? env.API_PUBLIC_URL ?? env.API_URL;
}

function environment_value(key: string | null | undefined) {
  const value = key ? process.env[key]?.trim() : undefined;
  return value || null;
}

function read_oauth_scope_separator(setup_state: ConnectionSetupState) {
  return setup_state.oauth_scope_separator === 'comma' ? ',' : ' ';
}
