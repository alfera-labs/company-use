import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { find_model_provider_account_row } from '@coworker/core/db/queries/model_provider_account_rows';
import { read_connection_credential_values } from '@coworker/core/integrations/credential_envelope';
import { AppError, create_logger } from '@coworker/shared';
import {
  chatgpt_plan_token_values,
  chatgpt_plan_value_names,
  list_chatgpt_plan_model_ids,
  refresh_chatgpt_plan_tokens,
} from '@runtime-platform/chatgpt_plan/chatgpt_plan_oauth';

const log = create_logger('chatgpt_plan_renewal');
const provider_slot = 'chatgpt_plan';
const renew_when_less_than_ms = 5 * 60 * 1000;

export async function refresh_chatgpt_sign_in(
  values: Record<string, string>,
): Promise<Record<string, string>> {
  const client_id = values[chatgpt_plan_value_names.client_id];
  const refresh_token = values[chatgpt_plan_value_names.refresh_token];
  if (!client_id || !refresh_token) {
    throw new AppError('chatgpt_sign_in_expired', 'Sign in to ChatGPT again.', 400);
  }

  const received_time_ms = Date.now();
  const tokens = await refresh_chatgpt_plan_tokens({ client_id, refresh_token });
  const model_ids = await list_model_ids_keeping_the_last_list(tokens.access_token, values);
  return {
    ...values,
    ...chatgpt_plan_token_values(tokens, received_time_ms),
    [chatgpt_plan_value_names.model_ids]: model_ids,
  };
}

async function list_model_ids_keeping_the_last_list(
  access_token: string,
  values: Record<string, string>,
): Promise<string> {
  try {
    return (await list_chatgpt_plan_model_ids(access_token)).join(',');
  } catch (error) {
    log.warn('kept the last ChatGPT plan model list, because listing the models failed', error);
    return values[chatgpt_plan_value_names.model_ids] ?? '';
  }
}

export function chatgpt_sign_in_renewal_is_due(values: Record<string, string>): boolean {
  const expires_at_ms = Number(values[chatgpt_plan_value_names.expires_at] ?? '');
  return Number.isFinite(expires_at_ms) && expires_at_ms - Date.now() <= renew_when_less_than_ms;
}

export async function chatgpt_plan_renewal_is_due(db: Database, workspace_id: string) {
  const stored = await read_workspace_chatgpt_plan_values(db, workspace_id);
  return stored !== null && chatgpt_sign_in_renewal_is_due(stored);
}

export async function read_workspace_chatgpt_plan_values(
  db: DatabaseExecutor,
  workspace_id: string,
) {
  const row = await find_model_provider_account_row(db, { workspace_id, provider_slot });
  if (!row || row.connection_status !== 'active') return null;
  return read_connection_credential_values(row.credentials);
}
