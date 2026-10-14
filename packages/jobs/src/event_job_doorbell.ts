import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { mark_queue_wake_sent } from '@coworker/jobs/queries/event_job_wakes';
import { create_logger } from '@coworker/shared';

const log = create_logger('event_job_doorbell');

export type DoorbellRing = { workspace_id: string; queue_key: string; job_ids: string[] };

export type Doorbell = {
  ring(input: DoorbellRing): Promise<void> | void;
  arm_clock?(wake_by_ms?: number): Promise<void>;
};

export type DoorbellOutcome = 'rung' | 'ring_failed' | 'not_rung';

export const ring_time_limit_ms = 15_000;

export const max_doorbell_delay_ms = 10_000;

let configured_doorbell: Doorbell | undefined;

export function configure_event_job_doorbell(doorbell: Doorbell | undefined) {
  configured_doorbell = doorbell;
}

export function arm_clock(wake_by_ms?: number) {
  void configured_doorbell?.arm_clock?.(wake_by_ms);
}

export function uses_rivet_event_job_dispatch() {
  return env.EVENT_JOB_DISPATCH_MODE === 'rivet';
}

export async function ring_queue_doorbell(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
    delay_ms?: number | undefined;
    job_ids?: string[] | undefined;
  },
): Promise<DoorbellOutcome> {
  const delay_ms = Math.max(input.delay_ms ?? 0, 0);
  const queue = { workspace_id: input.workspace_id, queue_key: input.queue_key };
  if (delay_ms === 0 && input.job_ids?.length) {
    arm_clock();
    const [outcome] = await Promise.all([
      ring_doorbell({ ...queue, job_ids: input.job_ids }),
      mark_queue_rung(db, queue),
    ]);
    return outcome;
  }
  const marked_jobs = await mark_queue_rung(db, queue);
  if (marked_jobs.length === 0) return 'not_rung';
  arm_clock();
  if (delay_ms > max_doorbell_delay_ms) return 'not_rung';
  if (delay_ms > 0) await new Promise((resolve) => setTimeout(resolve, delay_ms));
  return ring_doorbell({ ...queue, job_ids: marked_jobs.map((job) => job.job_id) });
}

function mark_queue_rung(db: Database, queue: { workspace_id: string; queue_key: string }) {
  return mark_queue_wake_sent(db, queue).catch((error: unknown) => {
    log.error('marking the doorbell ring failed; the recovery sweep will ring', {
      ...queue,
      error: error_message(error),
    });
    return [];
  });
}

async function ring_doorbell(ring: DoorbellRing): Promise<DoorbellOutcome> {
  if (!configured_doorbell) {
    log.error('rivet dispatch has no doorbell configured; the recovery sweep will ring', {
      workspace_id: ring.workspace_id,
      queue_key: ring.queue_key,
    });
    return 'not_rung';
  }
  try {
    await configured_doorbell.ring(ring);
    return 'rung';
  } catch (error) {
    log.error('ringing the queue worker failed; the job stays queued and the clock rings again', {
      workspace_id: ring.workspace_id,
      queue_key: ring.queue_key,
      job_ids: ring.job_ids,
      error: error_message(error),
    });
    return 'ring_failed';
  }
}

function error_message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
