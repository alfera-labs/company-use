import type { ConnectionSetupStateData } from '@coworker/core/db/schema/json_column_types';

export type PublicConnectionSetup = ConnectionSetupStateData & {
  authorization_url?: string | null;
  setup_error?: string | null;
};

export type ProviderConnectionCompletion =
  | {
      status: 'success';
      external_account_id: string;
      external_account_name?: string | undefined;
      authorized_scopes?: string[] | undefined;
      provider_account: Record<string, unknown>;
    }
  | {
      status: 'error';
      error_message: string;
    }
  | {
      status: 'pending';
      message: string;
    };

export function redact_connection_setup_state(setup_state: ConnectionSetupStateData) {
  const {
    oauth_code_verifier: _verifier,
    provider_webhook_token: _webhook_token,
    setup_token: _setup_token,
    ...public_setup_state
  } = setup_state;
  return public_setup_state;
}
