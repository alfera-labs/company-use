export const MICROCENTS_PER_DOLLAR = 100_000_000;

export const pricing_policy_usage_metadata = { pricing_version: 'at_cost' };

export function billable_usage_microcents(provider_cost_microcents: number) {
  return Math.max(0, provider_cost_microcents);
}
