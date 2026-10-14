import type { Database } from '@coworker/core';
import { get_run_cancel_intent } from '@coworker/core/db/queries/sessions';
import type { QueueRef } from '@coworker/jobs';
import { AppError } from '@coworker/shared';
import { cancel_active_agent_run } from '@runtime-platform/orchestrator/run_cancellation_registry';
import { read_signed_claims, sign_claims } from '@runtime-platform/signed_claims';
import { z } from 'zod';

const control_purpose = 'queue_worker_control';
const signature_lifetime_ms = 60_000;

const control_claims_schema = z
  .object({
    v: z.literal(2),
    key_scope: z.string().min(1),
    workspace_id: z.string().min(1),
    queue_key: z.string().min(1),
    run_id: z.string().min(1).optional(),
    exp: z.number().int().positive(),
  })
  .strict();

type ControlTarget = QueueRef & { key_scope: string; run_id?: string };

export function sign_queue_worker_control(target: ControlTarget, now: Date = new Date()) {
  const exp = Math.floor((now.getTime() + signature_lifetime_ms) / 1000);
  const run = target.run_id ? { run_id: target.run_id } : {};
  const queue = {
    key_scope: target.key_scope,
    workspace_id: target.workspace_id,
    queue_key: target.queue_key,
  };
  return sign_claims(control_purpose, { v: 2, ...queue, ...run, exp });
}

export function verify_queue_worker_control(
  api_signature: string,
  target: ControlTarget,
  now: Date = new Date(),
) {
  const parsed = control_claims_schema.safeParse(
    read_signed_claims(control_purpose, api_signature),
  );
  const claims = parsed.success ? parsed.data : null;
  const matches =
    claims !== null &&
    claims.exp * 1000 > now.getTime() &&
    claims.key_scope === target.key_scope &&
    claims.workspace_id === target.workspace_id &&
    claims.queue_key === target.queue_key &&
    (target.run_id === undefined || claims.run_id === target.run_id);
  if (!matches) {
    throw new AppError('queue_worker_control_refused', 'The request is not signed.', 403);
  }
}

export async function cancel_run_in_this_process(
  db: Database,
  target: { workspace_id: string; run_id: string },
) {
  const intent = await get_run_cancel_intent(db, target.workspace_id, target.run_id);
  if (!intent?.cancel_requested_time) return { stopping: false, was_running_here: false };
  return { stopping: true, was_running_here: cancel_active_agent_run(target.run_id) };
}
