import type { Database } from '@coworker/core/db/connection';
import { mark_model_provider_account_invalid } from '@coworker/core/db/queries/model_provider_accounts';
import { find_model_provider_account_slot_by_env_name } from '@coworker/core/integrations/model_provider_account_slots';
import { create_logger } from '@coworker/shared';

const log = create_logger('workspace_model_credential');

export const authentication_failure_pattern =
  /\b(401|403|unauthorized|authentication_error|invalid[_ -]?api[_ -]?key|incorrect api key|invalid x-api-key)\b/iu;

export async function mark_workspace_model_credential_invalid_after_auth_failure(
  db: Database,
  input: {
    workspace_id: string;
    credential_env_name: string;
    error_message: string;
    actor_id: string;
  },
): Promise<void> {
  if (!authentication_failure_pattern.test(input.error_message)) return;
  const provider_slot = find_model_provider_account_slot_by_env_name(input.credential_env_name);
  if (!provider_slot) return;

  try {
    await mark_model_provider_account_invalid(db, {
      workspace_id: input.workspace_id,
      provider_slot,
      error_message: input.error_message,
      actor_id: input.actor_id,
    });
  } catch (error) {
    log.error('could not mark a workspace model provider account invalid', error);
  }
}
