import {
  billable_usage_microcents,
  pricing_policy_usage_metadata,
} from '@coworker/config/credit_pricing';
import { describe, expect, it } from 'vitest';

describe('billable_usage_microcents in the open copy', () => {
  it('bills a run at what the model provider charged, with no margin and no minimum', () => {
    expect(pricing_policy_usage_metadata).toEqual({ pricing_version: 'at_cost' });
    expect(billable_usage_microcents(310_000)).toBe(310_000);
    expect(billable_usage_microcents(8_500_000)).toBe(8_500_000);
    expect(billable_usage_microcents(1)).toBe(1);
  });

  it('never bills a negative amount', () => {
    expect(billable_usage_microcents(-5)).toBe(0);
    expect(billable_usage_microcents(0)).toBe(0);
  });
});
