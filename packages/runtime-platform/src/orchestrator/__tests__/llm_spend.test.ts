import type { RuntimeRunUsage } from '@agent-core/runs/run_usage';
import { calculate_llm_spend } from '@runtime-platform/orchestrator/llm_spend';
import { describe, expect, it } from 'vitest';

const one_dollar_of_model_calls: RuntimeRunUsage = {
  input: 1000,
  output: 500,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 1500,
  cost: { total: 1, input: 0.6, output: 0.4 },
} as RuntimeRunUsage;

describe('what a run on the workspace’s own provider key costs', () => {
  it('bills nothing and still records what the provider charged', () => {
    const spend = calculate_llm_spend({
      usage: one_dollar_of_model_calls,
      billing_treatment: 'byok',
    });

    expect(spend.billable_cost_microcents).toBe(0);
    expect(spend.provider_cost_microcents).toBe(100_000_000);
    expect(spend.usage_metadata.billing).toMatchObject({
      billing_treatment: 'byok',
      provider_cost_microcents: 100_000_000,
      billable_cost_microcents: 0,
    });
  });

  it('still bills a run the deployment paid for', () => {
    const spend = calculate_llm_spend({
      usage: one_dollar_of_model_calls,
      billing_treatment: 'billed',
    });

    expect(spend.billable_cost_microcents).toBeGreaterThan(0);
  });
});
