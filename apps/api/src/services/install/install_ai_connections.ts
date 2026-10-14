import { refuse_key_for_another_provider } from '@api/services/install/key_for_another_provider';
import {
  check_pasted_model_key,
  finish_chatgpt_sign_in,
  start_chatgpt_sign_in,
} from '@api/services/models/ai_connections';
import type { DatabaseExecutor } from '@coworker/core';
import {
  delete_install_model_provider_account,
  list_install_model_provider_accounts,
  save_install_model_provider_account,
} from '@coworker/core/db/queries/install_model_provider_accounts';
import type { ModelProviderAccount } from '@coworker/core/db/queries/model_provider_accounts';
import {
  find_model_provider_account_slot,
  type ModelProviderAccountSlot,
} from '@coworker/core/integrations/model_provider_account_slots';
import { NotFoundError } from '@coworker/shared';

export type CheckedInstallAiValues = {
  provider_slot: ModelProviderAccountSlot;
  values: Record<string, string>;
};

export async function check_install_ai_key(input: {
  api_key: string;
  provider_slot?: string | undefined;
}): Promise<CheckedInstallAiValues> {
  const api_key = input.api_key.trim();
  if (input.provider_slot) {
    refuse_key_for_another_provider({ api_key, provider_slot: input.provider_slot });
  }
  const key = await check_pasted_model_key({
    api_key,
    ...(input.provider_slot ? { provider_slot: input.provider_slot } : {}),
  });
  return { provider_slot: key.provider_slot, values: { [key.env_name]: api_key } };
}

export function start_install_chatgpt_sign_in(bound_to: string) {
  return start_chatgpt_sign_in({ bound_to });
}

export async function redeem_install_chatgpt_sign_in(input: {
  sign_in_attempt: string;
  callback_url: string;
  bound_to: string;
}): Promise<CheckedInstallAiValues> {
  const result = await finish_chatgpt_sign_in(input);
  return { provider_slot: result.provider_slot, values: result.values };
}

export async function save_install_ai_values(
  db: DatabaseExecutor,
  input: CheckedInstallAiValues & { actor_id: string },
) {
  return public_ai_account(await save_install_model_provider_account(db, input));
}

export function public_ai_account(account: ModelProviderAccount) {
  return {
    provider_slot: account.provider_slot,
    display_name: account.display_name,
    secret_hint: account.secret_hint,
    credential_status: account.credential_status,
    last_validated_time: account.last_validated_time?.toISOString() ?? null,
    error_message: account.error_message,
  };
}

export async function list_install_ai_connections(db: DatabaseExecutor) {
  const accounts = await list_install_model_provider_accounts(db);
  return accounts.map(public_ai_account);
}

export async function disconnect_install_ai_key(db: DatabaseExecutor, provider_slot_text: string) {
  const provider_slot = find_model_provider_account_slot(provider_slot_text);
  if (!provider_slot || !(await delete_install_model_provider_account(db, provider_slot))) {
    throw new NotFoundError('AI key');
  }
  return { provider_slot };
}
