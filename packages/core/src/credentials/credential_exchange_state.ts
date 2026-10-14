import type { ConnectionConfigData } from '@coworker/core/db/schema/json_column_types';
import { z } from 'zod';

const credential_exchange_outcomes = [
  'succeeded',
  'rejected',
  'rate_limited',
  'unreachable',
  'misconfigured',
] as const;

export type CredentialExchangeOutcome = (typeof credential_exchange_outcomes)[number];

const credential_exchange_state_schema = z
  .object({
    last_outcome: z.enum(credential_exchange_outcomes),
    last_attempted_time: z.string(),
    last_vendor_message: z.string().optional(),
    retry_allowed_after_time: z.string().optional(),
    consecutive_failure_count: z.number().int().min(0),
  })
  .strict();

export type CredentialExchangeState = z.infer<typeof credential_exchange_state_schema>;

export function read_credential_exchange_state(
  connection_config: unknown,
): CredentialExchangeState | null {
  if (typeof connection_config !== 'object' || connection_config === null) return null;
  const block = (connection_config as Record<string, unknown>).credential_exchange;
  if (block === undefined) return null;
  const parsed = credential_exchange_state_schema.safeParse(block);
  return parsed.success ? parsed.data : null;
}

export type AttemptDecision =
  | { may_attempt: true }
  | {
      may_attempt: false;
      outcome: 'rate_limited' | 'rejected';
      reason: string;
      retry_allowed_after_time?: string | undefined;
    };

export function decide_whether_to_attempt(input: {
  state: CredentialExchangeState | null;
  now: Date;
  stop_after_failures: number;
}): AttemptDecision {
  const { state, now } = input;
  if (!state) return { may_attempt: true };

  if (state.retry_allowed_after_time) {
    const allowed_at = new Date(state.retry_allowed_after_time);
    if (Number.isFinite(allowed_at.getTime()) && allowed_at > now) {
      return {
        may_attempt: false,
        outcome: 'rate_limited',
        reason: 'That site asked us to wait before trying again.',
        retry_allowed_after_time: state.retry_allowed_after_time,
      };
    }
  }

  if (
    state.last_outcome === 'rejected' &&
    state.consecutive_failure_count >= input.stop_after_failures
  ) {
    return {
      may_attempt: false,
      outcome: 'rejected',
      reason:
        'That site rejected the saved username and password. Update them before trying again.',
    };
  }

  return { may_attempt: true };
}

export function generate_credential_exchange_state(input: {
  previous: CredentialExchangeState | null;
  outcome: CredentialExchangeOutcome;
  now: Date;
  vendor_message?: string | undefined;
  wait_minutes?: number | undefined;
}): CredentialExchangeState {
  const failed = input.outcome !== 'succeeded';
  return {
    last_outcome: input.outcome,
    last_attempted_time: input.now.toISOString(),
    ...(input.vendor_message ? { last_vendor_message: input.vendor_message } : {}),
    ...(input.wait_minutes && input.wait_minutes > 0
      ? {
          retry_allowed_after_time: new Date(
            input.now.getTime() + input.wait_minutes * 60_000,
          ).toISOString(),
        }
      : {}),
    consecutive_failure_count: failed ? (input.previous?.consecutive_failure_count ?? 0) + 1 : 0,
  };
}

export function write_credential_exchange_state(
  connection_config: ConnectionConfigData,
  state: CredentialExchangeState,
): Record<string, unknown> {
  return { ...connection_config, credential_exchange: state };
}
