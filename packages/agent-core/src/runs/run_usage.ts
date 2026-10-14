import type { RuntimeRunEvent } from '@agent-core/events/runtime_event';
import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import type { RuntimeAgentEngineEvent } from '@agent-core/runs/agent_run';

// What a run actually cost, summed over every model call it made.
//
// A provider reports usage per response, so a run that made 112 calls has 112 usage records and
// no total. Reading one of them — the last, the largest, any of them — describes that one call,
// not the run. Anthropic also reports `input` as the *uncached* remainder, so the final call of a
// long run legitimately reports an input of 2 while having read 300k tokens from cache. Both facts
// together are why a run must add its usage up as it goes rather than pick a record at the end.
export type RuntimeRunUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

export function empty_run_usage(): RuntimeRunUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function read_message_usage(message?: RuntimeAgentMessage): RuntimeRunUsage | undefined {
  const usage = message?.metadata?.usage;
  if (!usage) return undefined;

  return {
    ...usage,
    totalTokens:
      usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
  };
}

export function add_run_usage(total: RuntimeRunUsage, next: RuntimeRunUsage): RuntimeRunUsage {
  return {
    input: total.input + next.input,
    output: total.output + next.output,
    cacheRead: total.cacheRead + next.cacheRead,
    cacheWrite: total.cacheWrite + next.cacheWrite,
    totalTokens: total.totalTokens + next.totalTokens,
    cost: {
      input: total.cost.input + next.cost.input,
      output: total.cost.output + next.cost.output,
      cacheRead: total.cost.cacheRead + next.cost.cacheRead,
      cacheWrite: total.cost.cacheWrite + next.cost.cacheWrite,
      total: total.cost.total + next.cost.total,
    },
  };
}

export function run_usage_has_any_model_call(usage: RuntimeRunUsage) {
  return usage.totalTokens > 0 || usage.cost.total > 0 || usage.output > 0;
}

export const retried_call_event_label = 'pi.retry_scheduled';

export function read_run_event_usage(event: RuntimeRunEvent): RuntimeRunUsage | undefined {
  if (event.event_type === 'message') return read_message_usage(event.message);
  return event.event_type === 'progress' ? read_retried_call_usage(event) : undefined;
}

export function read_engine_event_usage(
  event: RuntimeAgentEngineEvent,
): RuntimeRunUsage | undefined {
  if (event.type === 'message') return read_message_usage(event.message);
  return event.type === 'progress' ? read_retried_call_usage(event) : undefined;
}

function read_retried_call_usage(progress: {
  label: string;
  metadata?: Record<string, unknown>;
}): RuntimeRunUsage | undefined {
  if (progress.label !== retried_call_event_label) return undefined;
  const usage = progress.metadata?.usage;
  return is_run_usage(usage) ? usage : undefined;
}

function is_run_usage(value: unknown): value is RuntimeRunUsage {
  if (typeof value !== 'object' || value === null) return false;
  const usage = value as Partial<RuntimeRunUsage>;
  return (
    typeof usage.totalTokens === 'number' &&
    typeof usage.cost === 'object' &&
    usage.cost !== null &&
    typeof usage.cost.total === 'number'
  );
}
