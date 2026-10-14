import type { RuntimeRunUsage } from '@agent-core/runs/run_usage';
import {
  billable_usage_microcents,
  pricing_policy_usage_metadata,
} from '@coworker/config/credit_pricing';

export type LlmBillingTreatment = 'billed' | 'absorbed' | 'byok';

const billable_microcents_by_treatment: Record<
  LlmBillingTreatment,
  (provider_cost_microcents: number) => number
> = {
  billed: (provider_cost_microcents) => billable_usage_microcents(provider_cost_microcents),
  absorbed: () => 0,
  byok: () => 0,
};

export type LlmSpend = {
  provider_cost_microcents: number;
  billable_cost_microcents: number;
  total_tokens: number;
  usage_metadata: Record<string, unknown>;
};

export function calculate_llm_spend(input: {
  usage: RuntimeRunUsage;
  billing_treatment: LlmBillingTreatment;
}): LlmSpend {
  const provider_cost_microcents = Math.round(input.usage.cost.total * 100_000_000);
  const billable_cost_microcents =
    billable_microcents_by_treatment[input.billing_treatment](provider_cost_microcents);

  return {
    provider_cost_microcents,
    billable_cost_microcents,
    total_tokens: input.usage.totalTokens,
    usage_metadata: {
      provider_usage: input.usage,
      billing: {
        ...pricing_policy_usage_metadata,
        billing_treatment: input.billing_treatment,
        provider_cost_microcents,
        billable_cost_microcents,
      },
    },
  };
}
