import type { Database } from '@coworker/core/db/connection';
import {
  mark_install_model_provider_account_invalid,
  read_install_model_provider_account_stored_values,
  save_install_model_provider_account,
} from '@coworker/core/db/queries/install_model_provider_accounts';
import {
  claim_install_account_renewal,
  lock_install_account_values,
} from '@coworker/core/db/queries/model_provider_account_renewal';
import {
  chatgpt_plan_renewal_actor_id as actor_id,
  type ChatgptPlanSignInStore,
  renew_chatgpt_plan_sign_in,
} from '@runtime-platform/chatgpt_plan/chatgpt_plan_renewal_claim';

const provider_slot = 'chatgpt_plan';

const install_sign_in_store: ChatgptPlanSignInStore = {
  read_values: (db) => read_install_model_provider_account_stored_values(db, provider_slot),
  claim_renewal: (db, claimed_until) =>
    claim_install_account_renewal(db, { provider_slot, claimed_until, actor_id }),
  lock_values: (db) => lock_install_account_values(db, provider_slot),
  save_values: async (db, values) => {
    await save_install_model_provider_account(db, { provider_slot, values, actor_id });
  },
  mark_invalid: (db, error_message) =>
    mark_install_model_provider_account_invalid(db, { provider_slot, error_message, actor_id }),
};

/** Renews the ChatGPT plan sign-in of the whole install when its access token is about to end. */
export function renew_install_chatgpt_plan_before_it_expires(db: Database): Promise<void> {
  return renew_chatgpt_plan_sign_in(db, install_sign_in_store);
}
