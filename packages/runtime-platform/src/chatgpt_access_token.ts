import type { Database } from '@coworker/core/db/connection';
import { mark_model_provider_account_invalid } from '@coworker/core/db/queries/model_provider_accounts';
import {
  read_model_provider_oauth_tokens,
  save_model_provider_oauth_tokens,
} from '@coworker/core/db/queries/model_provider_oauth_tokens';
import { AppError, format_error_message } from '@coworker/shared';
import {
  chatgpt_unreachable_code,
  refresh_chatgpt_tokens,
} from '@runtime-platform/openai_codex_oauth';

const provider_slot = 'chatgpt';
const actor_id = 'system:chatgpt_token_refresh';
const renew_when_less_than_ms = 5 * 60 * 1000;

export async function chatgpt_access_token_renewal_is_due(db: Database, workspace_id: string) {
  const stored = await read_model_provider_oauth_tokens(db, { workspace_id, provider_slot });
  return stored !== null && renewal_is_due(stored);
}

function renewal_is_due(stored: { expires_at_ms: number }) {
  return stored.expires_at_ms - Date.now() <= renew_when_less_than_ms;
}

export async function renew_chatgpt_access_token_before_it_expires(
  db: Database,
  workspace_id: string,
): Promise<void> {
  const stored = await read_model_provider_oauth_tokens(db, { workspace_id, provider_slot });
  if (!stored || !renewal_is_due(stored)) return;

  try {
    const tokens = await refresh_chatgpt_tokens(stored.refresh_token);
    await save_model_provider_oauth_tokens(db, {
      workspace_id,
      provider_slot,
      actor_id,
      tokens,
      account_id: tokens.chatgpt_account_id,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === chatgpt_unreachable_code) throw error;
    if (await another_run_already_renewed_it(db, workspace_id, stored.refresh_token)) return;

    await mark_model_provider_account_invalid(db, {
      workspace_id,
      provider_slot,
      error_message: format_error_message(error),
      actor_id,
    });
  }
}

// Refresh tokens rotate, so two runs starting together race and the loser presents a token that was
// already spent. That is a lost race, not a dead account: the winner's token is in the row.
//
// Optimistic, no row lock. Lock the connection row if a workspace ever starts enough
// concurrent runs that losing races costs a visible number of refresh calls.
async function another_run_already_renewed_it(
  db: Database,
  workspace_id: string,
  spent_refresh_token: string,
): Promise<boolean> {
  const stored = await read_model_provider_oauth_tokens(db, { workspace_id, provider_slot });
  return stored !== null && stored.refresh_token !== spent_refresh_token;
}
