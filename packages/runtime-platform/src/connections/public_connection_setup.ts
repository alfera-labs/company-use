import type { Database } from '@coworker/core';
import type {
  ConnectionCredentialData,
  ConnectionSetupStateData,
} from '@coworker/core/db/schema/json_column_types';
import { find_connection_provider_adapter } from '@runtime-platform/connections/connection_provider_adapters';
import type { PublicConnectionSetup } from '@runtime-platform/connections/connection_setup_contract';
import { build_public_oauth_setup } from '@runtime-platform/connections/oauth_connection_setup';

export async function build_public_connection_setup(input: {
  provider_key?: string | null;
  setup_state: ConnectionSetupStateData;
  redirect_uri?: string | undefined;
  request_origin?: string | undefined;
  credentials?: ConnectionCredentialData | null;
  db: Database;
}): Promise<PublicConnectionSetup> {
  const setup_state = input.setup_state;
  if (setup_state.type === 'oauth2_authorization_code') {
    return build_public_oauth_setup(setup_state, input.credentials);
  }

  const adapter = find_connection_provider_adapter(input.provider_key);
  if (!adapter) return setup_state;

  return adapter.build_hosted_setup({
    setup_state,
    ...(input.redirect_uri ? { redirect_uri: input.redirect_uri } : {}),
    ...(input.request_origin ? { request_origin: input.request_origin } : {}),
    db: input.db,
  });
}
