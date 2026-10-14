import type { event_jobs } from '@coworker/core';
import { AppError, ConflictError } from '@coworker/shared';
import { z } from 'zod';

type EventJob = typeof event_jobs.$inferSelect;

export type SessionMessageOutcome =
  | { kind: 'waiting'; run_id: string | null }
  | { kind: 'ran'; run_id: string }
  | { kind: 'refused'; error: AppError };

const credit_refusal_codes = new Set(['card_required', 'out_of_credits']);

export function read_session_message_outcome(job: EventJob): SessionMessageOutcome {
  if (job.job_status === 'cancelled') {
    return {
      kind: 'refused',
      error: new ConflictError('The message was removed before it ran.', { job_id: job.job_id }),
    };
  }
  const is_finished = ['done', 'failed', 'dead'].includes(job.job_status);
  if (!is_finished) return { kind: 'waiting', run_id: job.run_id };
  if (job.run_id) return { kind: 'ran', run_id: job.run_id };
  return { kind: 'refused', error: refusal_error(job) };
}

const stored_record_schema = z.record(z.string(), z.unknown());

const message_refusal_schema = z.strictObject({
  code: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
});

function read_refusal_fields(data: unknown) {
  const record = stored_record_schema.safeParse(data).data ?? {};
  const fields = { code: record.code, message: record.message };
  return message_refusal_schema.safeParse(fields).data ?? {};
}

function refusal_error(job: EventJob) {
  const result = read_refusal_fields(job.result_data);
  const failure = read_refusal_fields(job.error_data);
  const code = result.code ?? failure.code;
  const message = result.message ?? 'The message could not be run. Please try again.';
  if (code && credit_refusal_codes.has(code)) return new AppError(code, message, 402);
  return new AppError(code ?? 'message_not_run', message, 409, { job_id: job.job_id });
}
