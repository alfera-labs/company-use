import {
  type ApiKeySlot,
  api_key_checks,
  api_key_slots,
  build_api_key_check_request,
  is_api_key_slot,
  refused_api_keys,
} from '@api/services/models/model_key_checks';
import { model_provider_account_slots } from '@coworker/core/integrations/model_provider_account_slots';
import { AppError } from '@coworker/shared';

export type CheckedModelKey = { provider_slot: ApiKeySlot; env_name: string; display_name: string };

type KeyCheckOutcome = 'accepted' | 'rejected' | 'no_credit' | 'unreachable';

const shortest_api_key = 20;
const check_timeout_ms = 10_000;

export async function check_pasted_model_key(input: {
  api_key: string;
  provider_slot?: string | undefined;
}): Promise<CheckedModelKey> {
  const api_key = input.api_key.trim();
  refuse_keys_that_must_not_be_stored(api_key);
  const slot = input.provider_slot
    ? require_api_key_slot(input.provider_slot)
    : the_only_slot_for(api_key);
  const outcome = await check_key_with(slot, api_key);
  return describe_checked_key(choose_the_provider([{ slot, outcome }]));
}

function the_only_slot_for(api_key: string): ApiKeySlot {
  const candidates = find_candidate_slots(api_key);
  const [only_candidate] = candidates;
  if (!only_candidate) throw provider_needed_error();
  if (candidates.length > 1) throw several_providers_error(candidates);
  return only_candidate;
}

export function find_candidate_slots(api_key: string): ApiKeySlot[] {
  const matches = api_key_slots.flatMap((slot) =>
    api_key_checks[slot].key_starts_with
      .filter((prefix) => api_key.startsWith(prefix))
      .map((prefix) => ({ slot, length: prefix.length })),
  );
  const longest = Math.max(...matches.map((match) => match.length));
  return [...new Set(matches.filter((match) => match.length === longest).map((m) => m.slot))];
}

export async function check_key_with(slot: ApiKeySlot, api_key: string): Promise<KeyCheckOutcome> {
  try {
    const response = await fetch(build_api_key_check_request(slot, api_key), {
      signal: AbortSignal.timeout(check_timeout_ms),
    });
    if (response.status === 429 && (await says_the_key_has_no_credit(response))) return 'no_credit';
    return classify_check_status(response.status);
  } catch {
    return 'unreachable';
  }
}

async function says_the_key_has_no_credit(response: Response) {
  const body = await response.text().catch(() => '');
  return /insufficient_quota|credit balance|billing/i.test(body);
}

function classify_check_status(status: number): KeyCheckOutcome {
  if ((status >= 200 && status < 300) || status === 429) return 'accepted';
  if (status === 402) return 'no_credit';
  if (status === 400 || status === 401 || status === 403 || status === 404) return 'rejected';
  return 'unreachable';
}

function refuse_keys_that_must_not_be_stored(api_key: string) {
  if (api_key.length < shortest_api_key) {
    throw new AppError('model_key_too_short', 'Paste the whole key. It is longer than this.', 400);
  }
  const refused = refused_api_keys.find((entry) => api_key.startsWith(entry.key_starts_with));
  if (refused) throw new AppError(refused.code, refused.message, 400);
}

function require_api_key_slot(provider_slot: string): ApiKeySlot {
  if (is_api_key_slot(provider_slot)) return provider_slot;
  throw new AppError(
    'model_provider_takes_no_api_key',
    'This provider does not take an API key.',
    400,
    { provider_slot },
  );
}

export function choose_the_provider(
  outcomes: { slot: ApiKeySlot; outcome: KeyCheckOutcome }[],
): ApiKeySlot {
  const slots_with = (outcome: KeyCheckOutcome) =>
    outcomes.filter((entry) => entry.outcome === outcome).map((entry) => entry.slot);
  const [accepted, no_credit, unreachable] = [
    slots_with('accepted'),
    slots_with('no_credit'),
    slots_with('unreachable'),
  ];
  const [only_accepted] = accepted;
  if (only_accepted && accepted.length === 1) return only_accepted;
  if (accepted.length > 1) throw several_providers_error(accepted);
  const [first_without_credit] = no_credit;
  if (first_without_credit) throw no_credit_error(first_without_credit);
  const [first_unreachable] = unreachable;
  if (first_unreachable) throw unreachable_error(first_unreachable);
  throw rejected_error(outcomes.map((entry) => entry.slot));
}

function describe_checked_key(provider_slot: ApiKeySlot): CheckedModelKey {
  const slot = model_provider_account_slots[provider_slot];
  return { provider_slot, env_name: slot.env_name, display_name: slot.display_name };
}

function display_name(slot: ApiKeySlot) {
  return model_provider_account_slots[slot].display_name;
}

function several_providers_error(slots: ApiKeySlot[]) {
  const candidates = slots.map((slot) => ({
    provider_slot: slot,
    display_name: display_name(slot),
  }));
  return new AppError('model_key_fits_several_providers', 'Which company gave you this key?', 409, {
    candidates,
  });
}

function provider_needed_error() {
  const candidates = api_key_slots.map((slot) => ({
    provider_slot: slot,
    display_name: display_name(slot),
  }));
  return new AppError('model_key_needs_provider', 'Which company gave you this key?', 409, {
    candidates,
  });
}

function no_credit_error(slot: ApiKeySlot) {
  return new AppError(
    'model_provider_has_no_credit',
    `${display_name(slot)} accepted the key, but the account has no credit. Add credit, then try again.`,
    400,
    { provider_slot: slot },
  );
}

function unreachable_error(slot: ApiKeySlot) {
  return new AppError(
    'model_provider_unreachable',
    `We could not reach ${display_name(slot)}. Check this server's internet and try again.`,
    502,
    { provider_slot: slot },
  );
}

function rejected_error(slots: ApiKeySlot[]) {
  const [only_slot] = slots;
  if (only_slot && slots.length === 1) {
    return new AppError(
      'model_provider_key_rejected',
      `${display_name(only_slot)} refused this key. Make a new key and paste it.`,
      400,
      { provider_slot: only_slot },
    );
  }
  return new AppError(
    'model_key_not_recognized',
    'No provider accepted this key. Check that you copied all of it.',
    400,
    { checked_provider_slots: slots },
  );
}
