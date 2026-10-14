import type { Database } from '@coworker/core/db/connection';
import {
  claim_workspace_account_renewal,
  lock_workspace_account_values,
} from '@coworker/core/db/queries/model_provider_account_renewal';
import { save_model_provider_account_row } from '@coworker/core/db/queries/model_provider_account_rows';
import { mark_model_provider_account_invalid } from '@coworker/core/db/queries/model_provider_accounts';
import { read_workspace_chatgpt_plan_values } from '@runtime-platform/chatgpt_plan/chatgpt_plan_renewal';
import {
  chatgpt_plan_renewal_actor_id as actor_id,
  type ChatgptPlanSignInStore,
  renew_chatgpt_plan_sign_in,
} from '@runtime-platform/chatgpt_plan/chatgpt_plan_renewal_claim';

const provider_slot = 'chatgpt_plan';

function workspace_sign_in_store(workspace_id: string): ChatgptPlanSignInStore {
  const account = { workspace_id, provider_slot } as const;
  return {
    read_values: (db) => read_workspace_chatgpt_plan_values(db, workspace_id),
    claim_renewal: (db, claimed_until) =>
      claim_workspace_account_renewal(db, { ...account, claimed_until, actor_id }),
    lock_values: (db) => lock_workspace_account_values(db, account),
    save_values: (db, values) =>
      save_model_provider_account_row(db, {
        ...account,
        values,
        metadata: { error_message: null },
        actor_id,
        now: new Date(),
      }),
    mark_invalid: (db, error_message) =>
      mark_model_provider_account_invalid(db, { ...account, error_message, actor_id }),
  };
}

/** Renews the ChatGPT plan sign-in of one workspace when its access token is about to end. */
export function renew_chatgpt_plan_access_token_before_it_expires(
  db: Database,
  workspace_id: string,
): Promise<void> {
  return renew_chatgpt_plan_sign_in(db, workspace_sign_in_store(workspace_id));
}
