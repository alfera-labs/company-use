import { z } from 'zod';
import type { Run } from '@/lib/api';

export type RunCostFields = Pick<
  Run,
  | 'model_name'
  | 'input_tokens'
  | 'output_tokens'
  | 'cache_read_tokens'
  | 'cache_write_tokens'
  | 'cost_microcents'
  | 'usage_metadata'
>;

const microcents_per_dollar = 100_000_000;

const billing_metadata_schema = z.object({
  billing: z.object({ provider_cost_microcents: z.number().finite() }),
});

/**
 * What the model provider charged for a run, in microcents, or undefined when no cost was
 * reported. A run on a deployment key stores the cost on the run. A run on a key saved in the
 * workspace stores 0 there and keeps the provider cost in its billing metadata.
 */
export function read_run_provider_cost_microcents(run: RunCostFields): number | undefined {
  const reported = run.cost_microcents > 0 ? run.cost_microcents : read_billing_provider_cost(run);
  return reported !== undefined && reported > 0 ? reported : undefined;
}

function read_billing_provider_cost(run: RunCostFields): number | undefined {
  const parsed = billing_metadata_schema.safeParse(run.usage_metadata);
  return parsed.success ? parsed.data.billing.provider_cost_microcents : undefined;
}

/** A cost in dollars with two decimals. A cost under one cent reads `<$0.01`, never `$0.00`. */
export function format_provider_cost(cost_microcents: number) {
  const dollars = cost_microcents / microcents_per_dollar;
  return dollars < 0.01 ? '<$0.01' : `$${dollars.toFixed(2)}`;
}

/** A token count in at most four characters: 850, 12.4k, 1.2M. */
export function format_token_count(token_count: number) {
  if (token_count < 1_000) return String(token_count);
  if (token_count < 1_000_000) return `${trim_trailing_zero(token_count / 1_000)}k`;
  return `${trim_trailing_zero(token_count / 1_000_000)}M`;
}

function trim_trailing_zero(value: number) {
  return value.toFixed(1).replace(/\.0$/u, '');
}

/**
 * One line about a finished run: its model, the tokens it read and wrote, and its cost when
 * the provider reported one. For example `claude-opus-4 · 12.4k tokens in, 1.1k out · $0.27`.
 * Undefined for a run that used no tokens yet.
 */
export function describe_run_cost(run: RunCostFields): string | undefined {
  const tokens_in = run.input_tokens + run.cache_read_tokens + run.cache_write_tokens;
  if (tokens_in + run.output_tokens === 0) return undefined;
  const cost = read_run_provider_cost_microcents(run);
  return [
    run.model_name,
    `${format_token_count(tokens_in)} tokens in, ${format_token_count(run.output_tokens)} out`,
    cost === undefined ? null : format_provider_cost(cost),
  ]
    .filter(Boolean)
    .join(' · ');
}
