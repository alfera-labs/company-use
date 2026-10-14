import type { Database } from '@coworker/core';
import { merge_pending_connection_setup_state } from '@coworker/core/db/queries/connection_management';
import type { ConnectionSetupStateData } from '@coworker/core/db/schema/json_column_types';
import type {
  ComposioAuthConfig,
  ComposioConnectedAccount,
} from '@coworker/core/integrations/composio_api_records';
import { create_logger, format_error_message } from '@coworker/shared';
import { probe_connected_account_identity } from '@runtime-platform/composio/composio_account_identity';
import {
  type ComposioClient,
  composio_is_configured,
  get_composio_client,
} from '@runtime-platform/composio/composio_client';
import type { RevocableConnection } from '@runtime-platform/connections/connection_provider_adapters';
import { build_connection_return_uri } from '@runtime-platform/connections/connection_return_uri';
import {
  type ProviderConnectionCompletion,
  type PublicConnectionSetup,
  redact_connection_setup_state,
} from '@runtime-platform/connections/connection_setup_contract';

const log = create_logger('composio_connect');

type ComposioSetupStrategy = {
  type?: string;
  auth_scheme?: string;
  auth_config_source?: 'composio_managed' | 'custom';
};

const pending_connected_account_statuses = new Set(['INITIALIZING', 'INITIATED']);

export async function build_composio_hosted_setup(input: {
  setup_state: ConnectionSetupStateData;
  redirect_uri?: string | undefined;
  request_origin?: string | undefined;
  db: Database;
  client?: ComposioClient | undefined;
}): Promise<PublicConnectionSetup> {
  const setup_state = input.setup_state;
  if (!input.client && !composio_is_configured()) {
    return hosted_setup_error(
      setup_state,
      'Composio is not configured. Set COMPOSIO_API_KEY to open hosted setup.',
    );
  }

  const toolkit_slug = setup_state.provider_app_key?.trim();
  if (!toolkit_slug) {
    return hosted_setup_error(setup_state, 'Connection setup is missing provider_app_key.');
  }

  const user_id = setup_state.external_user_key?.trim();
  if (!user_id) {
    return hosted_setup_error(setup_state, 'Connection setup is missing external_user_key.');
  }

  const strategy = read_setup_strategy(setup_state);
  const auth_scheme = strategy.auth_scheme?.trim() || 'OAUTH2';
  const auth_config_source = strategy.auth_config_source ?? 'composio_managed';

  try {
    const client = input.client ?? get_composio_client();
    const auth_config_id = await find_or_create_auth_config(client, {
      toolkit_slug,
      auth_scheme,
      auth_config_source,
    });
    const link = await client.create_connect_link({
      auth_config_id,
      user_id,
      ...(input.redirect_uri
        ? { callback_url: build_connection_return_uri(input.redirect_uri, setup_state) }
        : {}),
    });

    await persist_hosted_setup_state(input.db, setup_state, {
      provider_auth_config_id: auth_config_id,
      provider_connected_account_id: link.connected_account_id,
      hosted_connect_link: link.redirect_url,
      hosted_connect_expires_at: link.expires_at,
    });

    return {
      ...redact_connection_setup_state(setup_state),
      provider_auth_config_id: auth_config_id,
      provider_connected_account_id: link.connected_account_id,
      hosted_connect_link: link.redirect_url,
      hosted_connect_expires_at: link.expires_at,
      setup_error: null,
    };
  } catch (error) {
    return hosted_setup_error(setup_state, format_error_message(error, 'Composio setup failed.'));
  }
}

export async function complete_composio_connection_setup(input: {
  setup_state: ConnectionSetupStateData;
  client?: ComposioClient | undefined;
}): Promise<ProviderConnectionCompletion> {
  const connected_account_id = input.setup_state.provider_connected_account_id?.trim();
  if (!connected_account_id) {
    return {
      status: 'pending',
      message: 'Connection setup has not created a Composio connected account yet.',
    };
  }

  try {
    const client = input.client ?? get_composio_client();
    const account = await client.get_connected_account(connected_account_id);
    return connected_account_to_completion(client, account);
  } catch (error) {
    return {
      status: 'error',
      error_message: format_error_message(error, 'Composio setup failed.'),
    };
  }
}

export async function delete_composio_connected_account(connection: RevocableConnection) {
  const connected_account_id = read_connected_account_id(connection);
  if (!connected_account_id || !composio_is_configured()) return;

  try {
    await get_composio_client().delete_connected_account(connected_account_id, {
      revoke_on_delete: true,
    });
  } catch (error) {
    log.warn('Could not delete a Composio connected account', {
      connection_id: connection.connection_id,
      connected_account_id,
      error: format_error_message(error),
    });
  }
}

export function read_connected_account_id(connection: RevocableConnection) {
  return (
    connection.external_account_id?.trim() ||
    connection.provider_account?.connected_account_id?.trim() ||
    null
  );
}

// What the provider granted, not what Composio asked for. Attio's managed app requests seven
// scopes and Attio answers with thirteen (every one read-write); `requested_scopes` alone made the
// runtime refuse a company create the token could perform. The token itself stays in `state.val`.
function read_authorized_scopes(account: ComposioConnectedAccount) {
  const granted = account.state?.val?.scope;
  const granted_scopes = Array.isArray(granted)
    ? granted
    : typeof granted === 'string'
      ? granted.split(/[\s,]+/u)
      : [];
  const scopes = [...granted_scopes, ...(account.requested_scopes ?? [])]
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  return [...new Set(scopes)];
}

async function connected_account_to_completion(
  client: ComposioClient,
  account: ComposioConnectedAccount,
): Promise<ProviderConnectionCompletion> {
  if (account.status === 'ACTIVE') {
    const identity = await probe_connected_account_identity(client, account);
    const external_account_name =
      identity?.display_name ?? account.alias ?? account.word_id ?? undefined;
    return {
      status: 'success',
      external_account_id: account.id,
      ...(external_account_name ? { external_account_name } : {}),
      authorized_scopes: read_authorized_scopes(account),
      provider_account: {
        connected_account_id: account.id,
        auth_config_id: account.auth_config?.id,
        auth_scheme: account.auth_config?.auth_scheme ?? account.state?.authScheme,
        toolkit_slug: account.toolkit.slug,
        user_id: account.user_id,
        word_id: account.word_id,
        ...(identity ? { identity: { endpoint: identity.endpoint, data: identity.data } } : {}),
        source: 'composio_connect_link',
      },
    };
  }

  if (pending_connected_account_statuses.has(account.status)) {
    return {
      status: 'pending',
      message: `Composio has not finished connecting this ${account.toolkit.slug} account yet (${account.status}).`,
    };
  }

  return {
    status: 'error',
    error_message:
      account.status_reason?.trim() ||
      `Composio reported the connected account as ${account.status}.`,
  };
}

async function find_or_create_auth_config(
  client: ComposioClient,
  input: {
    toolkit_slug: string;
    auth_scheme: string;
    auth_config_source: 'composio_managed' | 'custom';
  },
) {
  const existing = await client.list_auth_configs({ toolkit_slug: input.toolkit_slug });
  const match = existing.find((auth_config) => auth_config_matches(auth_config, input));
  if (match) return match.id;

  const created = await client.create_auth_config({
    toolkit: { slug: input.toolkit_slug },
    auth_config:
      input.auth_config_source === 'composio_managed'
        ? {
            type: 'use_composio_managed_auth',
            name: `alfera_${input.toolkit_slug}_managed`,
          }
        : {
            type: 'use_custom_auth',
            authScheme: input.auth_scheme,
            name: `alfera_${input.toolkit_slug}_${input.auth_scheme.toLowerCase()}`,
            credentials: {},
          },
  });
  return created.auth_config.id;
}

function auth_config_matches(
  auth_config: ComposioAuthConfig,
  input: { auth_scheme: string; auth_config_source: 'composio_managed' | 'custom' },
) {
  if (auth_config.status === 'DISABLED') return false;
  if (auth_config.auth_scheme !== input.auth_scheme) return false;
  const is_managed = auth_config.is_composio_managed === true;
  return input.auth_config_source === 'composio_managed' ? is_managed : !is_managed;
}

async function persist_hosted_setup_state(
  db: Database,
  setup_state: ConnectionSetupStateData,
  patch: Record<string, unknown>,
) {
  const connection_id = setup_state.connection_id?.trim();
  if (!connection_id) return;

  await merge_pending_connection_setup_state(db, { connection_id, patch });
}

function read_setup_strategy(setup_state: ConnectionSetupStateData): ComposioSetupStrategy {
  const strategy = setup_state.setup_strategy;
  return strategy && typeof strategy === 'object' ? (strategy as ComposioSetupStrategy) : {};
}

function hosted_setup_error(
  setup_state: ConnectionSetupStateData,
  setup_error: string,
): PublicConnectionSetup {
  return { ...redact_connection_setup_state(setup_state), setup_error };
}
