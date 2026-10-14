import { describe, expect, it } from 'vitest';
import {
  describe_run_cost,
  format_provider_cost,
  format_token_count,
  type RunCostFields,
  read_run_provider_cost_microcents,
} from '@/components/app/run_cost';

function run_with(fields: Partial<RunCostFields>): RunCostFields {
  return {
    model_name: 'claude-opus-4',
    input_tokens: 12_400,
    output_tokens: 1_100,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_microcents: 0,
    usage_metadata: {},
    ...fields,
  };
}

const on_a_deployment_key = run_with({
  cost_microcents: 27_000_000,
  usage_metadata: {
    billing: {
      billing_treatment: 'billed',
      provider_cost_microcents: 27_000_000,
      billable_cost_microcents: 27_000_000,
    },
  },
});

const on_a_workspace_key = run_with({
  cost_microcents: 0,
  usage_metadata: {
    billing: {
      billing_treatment: 'byok',
      provider_cost_microcents: 3_100_000,
      billable_cost_microcents: 0,
    },
  },
});

describe('the provider cost of a run', () => {
  it('is the cost on the run for a run on a deployment key', () => {
    expect(read_run_provider_cost_microcents(on_a_deployment_key)).toBe(27_000_000);
  });

  it('is the provider cost in the billing metadata for a run on a key saved in the workspace', () => {
    expect(read_run_provider_cost_microcents(on_a_workspace_key)).toBe(3_100_000);
  });

  it.each([
    ['no metadata', {}],
    ['an estimate with no price', { estimated: true }],
    ['a provider that reported 0', { billing: { provider_cost_microcents: 0 } }],
    ['a cost that is not a number', { billing: { provider_cost_microcents: '27' } }],
    ['metadata that is not a record', null],
  ])('is unknown with %s', (_name, usage_metadata) => {
    expect(read_run_provider_cost_microcents(run_with({ usage_metadata }))).toBeUndefined();
  });
});

describe('the words of a run', () => {
  it('names the model, the tokens and the cost', () => {
    expect(describe_run_cost(on_a_deployment_key)).toBe(
      'claude-opus-4 · 12.4k tokens in, 1.1k out · $0.27',
    );
    expect(describe_run_cost(on_a_workspace_key)).toBe(
      'claude-opus-4 · 12.4k tokens in, 1.1k out · $0.03',
    );
  });

  it('shows no cost, and never $0.00, when the provider reported none', () => {
    const words = describe_run_cost(run_with({ usage_metadata: { estimated: true } }));

    expect(words).toBe('claude-opus-4 · 12.4k tokens in, 1.1k out');
    expect(words).not.toContain('$');
  });

  it('counts the tokens read from and written to the prompt cache as tokens in', () => {
    const cached = run_with({
      input_tokens: 400,
      cache_read_tokens: 11_000,
      cache_write_tokens: 1_000,
    });

    expect(describe_run_cost(cached)).toBe('claude-opus-4 · 12.4k tokens in, 1.1k out');
  });

  it('says nothing about a run that used no tokens yet', () => {
    expect(describe_run_cost(run_with({ input_tokens: 0, output_tokens: 0 }))).toBeUndefined();
  });

  it('leaves the model out when the run names none', () => {
    expect(describe_run_cost(run_with({ model_name: null }))).toBe('12.4k tokens in, 1.1k out');
  });
});

describe('the formats', () => {
  it.each([
    [1, '<$0.01'],
    [999_999, '<$0.01'],
    [1_000_000, '$0.01'],
    [3_100_000, '$0.03'],
    [26_600_000, '$0.27'],
    [1_234_500_000, '$12.35'],
  ])('writes %i microcents as %s', (cost_microcents, written) => {
    expect(format_provider_cost(cost_microcents)).toBe(written);
  });

  it.each([
    [0, '0'],
    [850, '850'],
    [1_000, '1k'],
    [12_400, '12.4k'],
    [999_949, '999.9k'],
    [1_200_000, '1.2M'],
  ])('writes %i tokens as %s', (token_count, written) => {
    expect(format_token_count(token_count)).toBe(written);
  });
});
