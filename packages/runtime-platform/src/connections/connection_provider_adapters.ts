import type { Database } from '@coworker/core';
import type {
  ConnectionSetupStateData,
  ProviderAccountData,
} from '@coworker/core/db/schema/json_column_types';
import { composio_provider_key } from '@coworker/core/integrations/composio_schema';
import {
  build_composio_hosted_setup,
  complete_composio_connection_setup,
  delete_composio_connected_account,
} from '@runtime-platform/composio/composio_connect';
import type {
  ProviderConnectionCompletion,
  PublicConnectionSetup,
} from '@runtime-platform/connections/connection_setup_contract';

export type RevocableConnection = {
  connection_id: string;
  provider_key?: string | null;
  external_account_id?: string | null;
  provider_account?: ProviderAccountData;
};

export type HostedConnectionProviderAdapter = {
  provider_key: string;
  build_hosted_setup(input: {
    setup_state: ConnectionSetupStateData;
    redirect_uri?: string | undefined;
    request_origin?: string | undefined;
    db: Database;
  }): Promise<PublicConnectionSetup>;
  complete_setup(input: {
    setup_state: ConnectionSetupStateData;
    webhook_payload?: unknown;
  }): Promise<ProviderConnectionCompletion>;
  read_webhook_token?(setup_state: ConnectionSetupStateData): string | null;
  revoke_external_account?(connection: RevocableConnection): Promise<void>;
};

export const connection_provider_adapters: Record<string, HostedConnectionProviderAdapter> = {
  [composio_provider_key]: {
    provider_key: composio_provider_key,
    build_hosted_setup: (input) => build_composio_hosted_setup(input),
    complete_setup: (input) => complete_composio_connection_setup(input),
    read_webhook_token: (setup_state) => setup_state.provider_webhook_token?.trim() || null,
    revoke_external_account: (connection) => delete_composio_connected_account(connection),
  },
};

export function find_connection_provider_adapter(
  provider_key: string | null | undefined,
): HostedConnectionProviderAdapter | null {
  if (!provider_key || !Object.hasOwn(connection_provider_adapters, provider_key)) return null;
  return connection_provider_adapters[provider_key] ?? null;
}
