import type { Database } from '@coworker/core/db/connection';
import {
  find_model_provider_account_row,
  save_model_provider_account_row,
} from '@coworker/core/db/queries/model_provider_account_rows';
import type { ModelProviderAccount } from '@coworker/core/db/queries/model_provider_accounts';
import { read_connection_credential_values } from '@coworker/core/integrations/credential_envelope';
import {
  type ModelProviderAccountSlot,
  model_provider_account_slots,
} from '@coworker/core/integrations/model_provider_account_slots';

export type ModelProviderOauthTokens = {
  access_token: string;
  refresh_token: string;
  expires_at_ms: number;
};

export async function read_model_provider_oauth_tokens(
  db: Database,
  input: { workspace_id: string; provider_slot: ModelProviderAccountSlot },
): Promise<ModelProviderOauthTokens | null> {
  const row = await find_model_provider_account_row(db, input);
  if (!row || row.connection_status !== 'active') return null;

  const values = read_connection_credential_values(row.credentials);
  const names = oauth_value_names(input.provider_slot);
  const access_token = values[names.access_token];
  const refresh_token = values[names.refresh_token];
  const expires_at_ms = Number(values[names.expires_at] ?? '');
  if (!access_token || !refresh_token || !Number.isFinite(expires_at_ms)) return null;

  return { access_token, refresh_token, expires_at_ms };
}

export async function save_model_provider_oauth_tokens(
  db: Database,
  input: {
    workspace_id: string;
    provider_slot: ModelProviderAccountSlot;
    tokens: ModelProviderOauthTokens;
    account_id: string;
    actor_id: string;
  },
): Promise<ModelProviderAccount> {
  const names = oauth_value_names(input.provider_slot);
  const now = new Date();
  const secret_hint = input.account_id.slice(-4);

  await save_model_provider_account_row(db, {
    workspace_id: input.workspace_id,
    provider_slot: input.provider_slot,
    values: {
      [names.access_token]: input.tokens.access_token,
      [names.refresh_token]: input.tokens.refresh_token,
      [names.expires_at]: String(input.tokens.expires_at_ms),
    },
    metadata: { secret_hint, error_message: null },
    actor_id: input.actor_id,
    now,
  });

  return {
    provider_slot: input.provider_slot,
    display_name: model_provider_account_slots[input.provider_slot].display_name,
    secret_hint,
    credential_status: 'active',
    last_validated_time: now,
    error_message: null,
  };
}

function oauth_value_names(provider_slot: ModelProviderAccountSlot) {
  const slot = model_provider_account_slots[provider_slot];
  const [refresh_token, expires_at] = slot.private_value_names;
  if (!refresh_token || !expires_at) {
    throw new Error(`Model provider slot ${provider_slot} stores no OAuth tokens`);
  }
  return { access_token: slot.env_name, refresh_token, expires_at };
}
