import { createHash, randomBytes } from 'node:crypto';
import { ValidationError } from '@coworker/shared';

export type OAuthSetupStrategy = {
  type: 'oauth2_authorization_code';
  authorization_url: string;
  token_url: string;
  client_id?: string;
  client_id_env?: string;
  client_secret_env?: string;
  scopes?: string[];
  authorization_params?: Record<string, string>;
  token_auth_method?: 'client_secret_post' | 'client_secret_basic' | 'none';
  // What the token request's body is written in. Absent means form encoding, which is the spec
  // and what almost every provider takes. Notion's token endpoint parses JSON and nothing else.
  token_request_format?: 'form' | 'json';
  use_pkce?: boolean;
  scope_separator?: 'space' | 'comma';
  // RFC 8707 resource indicator. Names which protected resource the issued token
  // is for, so a token minted for one MCP server cannot be replayed against a
  // different one behind the same authorization server. Sent on BOTH the
  // authorize and token requests — carrying it on only one leg makes servers
  // that enforce it refuse the exchange.
  resource?: string;
};

export type WorkspaceOAuthClient = {
  client_id: string;
  client_secret?: string | undefined;
};

export type OAuthSetupState = {
  type: 'oauth2_authorization_code';
  connection_id: string;
  external_user_key: string;
  provider_app_key: string | null;
  redirect_uri: string | null;
  oauth_state_token: string;
  oauth_state_expires_time: string;
  oauth_code_verifier: string | null;
  oauth_code_challenge: string | null;
  oauth_code_challenge_method: 'S256' | null;
  oauth_authorization_url: string;
  oauth_token_url: string;
  oauth_client_id: string | null;
  oauth_client_id_env: string | null;
  oauth_client_secret_env: string | null;
  oauth_scopes: string[];
  oauth_scope_separator: 'space' | 'comma';
  oauth_authorization_params: Record<string, string>;
  oauth_token_auth_method: 'client_secret_post' | 'client_secret_basic' | 'none';
  oauth_token_request_format: 'form' | 'json';
  oauth_resource: string | null;
};

export function is_oauth_setup_strategy(
  value: Record<string, unknown>,
): value is OAuthSetupStrategy {
  return value.type === 'oauth2_authorization_code';
}

export function build_oauth_setup_state(input: {
  connection_id: string;
  external_user_key: string;
  provider_app_key?: string;
  redirect_uri?: string;
  setup_strategy: OAuthSetupStrategy;
  default_scopes: string[];
}): OAuthSetupState {
  assert_url(input.setup_strategy.authorization_url, 'authorization_url');
  assert_url(input.setup_strategy.token_url, 'token_url');

  const code_verifier = input.setup_strategy.use_pkce === false ? null : create_oauth_token(48);
  return {
    type: 'oauth2_authorization_code',
    connection_id: input.connection_id,
    external_user_key: input.external_user_key,
    provider_app_key: input.provider_app_key ?? null,
    redirect_uri: input.redirect_uri ?? null,
    oauth_state_token: create_oauth_token(32),
    oauth_state_expires_time: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    oauth_code_verifier: code_verifier,
    oauth_code_challenge: code_verifier ? create_code_challenge(code_verifier) : null,
    oauth_code_challenge_method: code_verifier ? 'S256' : null,
    oauth_authorization_url: input.setup_strategy.authorization_url,
    oauth_token_url: input.setup_strategy.token_url,
    oauth_client_id: input.setup_strategy.client_id ?? null,
    oauth_client_id_env: input.setup_strategy.client_id_env ?? null,
    oauth_client_secret_env: input.setup_strategy.client_secret_env ?? null,
    oauth_scopes: input.setup_strategy.scopes ?? input.default_scopes,
    oauth_scope_separator: input.setup_strategy.scope_separator ?? 'space',
    oauth_authorization_params: input.setup_strategy.authorization_params ?? {},
    oauth_token_auth_method: input.setup_strategy.token_auth_method ?? 'client_secret_post',
    oauth_token_request_format: input.setup_strategy.token_request_format ?? 'form',
    oauth_resource: input.setup_strategy.resource ?? null,
  };
}

function create_code_challenge(code_verifier: string) {
  return createHash('sha256').update(code_verifier).digest('base64url');
}

function create_oauth_token(byte_count: number) {
  return randomBytes(byte_count).toString('base64url');
}

function assert_url(value: string, label: string) {
  try {
    new URL(value);
  } catch {
    throw new ValidationError(`OAuth ${label} must be a valid URL`);
  }
}
