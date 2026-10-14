import { find_candidate_slots } from '@api/services/models/check_pasted_model_key';
import {
  find_model_provider_account_slot,
  model_provider_account_slots,
} from '@coworker/core/integrations/model_provider_account_slots';
import { AppError } from '@coworker/shared';

/**
 * Refuses a key whose start belongs to exactly one other provider than the one the person
 * picked, and names that provider, so the page can offer it in one click. A start that several
 * providers share proves nothing, and the chosen provider's own check decides.
 */
export function refuse_key_for_another_provider(input: { api_key: string; provider_slot: string }) {
  const chosen = find_model_provider_account_slot(input.provider_slot);
  const candidates = find_candidate_slots(input.api_key.trim());
  const [only_candidate] = candidates;
  if (!chosen || candidates.length !== 1 || !only_candidate || only_candidate === chosen) return;
  const suggested = model_provider_account_slots[only_candidate].display_name;
  throw new AppError(
    'model_key_is_for_another_provider',
    `This key looks like it is from ${suggested}, not ${model_provider_account_slots[chosen].display_name}.`,
    409,
    { suggested: { provider_slot: only_candidate, display_name: suggested } },
  );
}
