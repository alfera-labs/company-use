import type { RuntimeRunUsage } from '@agent-core/runs/run_usage';
import { calculate_llm_spend } from '@runtime-platform/orchestrator/llm_spend';
import { expect, it } from 'vitest';

function summariser_usage(): RuntimeRunUsage {
  return {
    input: 40_000,
    output: 900,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 40_900,
    cost: { input: 0.04, output: 0.0054, cacheRead: 0, cacheWrite: 0, total: 0.0454 },
  };
}

it('bills exactly the provider cost when the spend is billed', () => {
  const spend = calculate_llm_spend({ usage: summariser_usage(), billing_treatment: 'billed' });

  expect(spend.provider_cost_microcents).toBe(4_540_000);
  expect(spend.billable_cost_microcents).toBe(4_540_000);
});
