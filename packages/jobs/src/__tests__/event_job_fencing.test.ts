import { randomUUID } from 'node:crypto';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { event_jobs } from '@coworker/core/db/schema';
import {
  claim_ready_event_jobs_for_queue,
  EventJobClaimLostError,
  type EventJobHandler,
  extend_event_job_lock,
  recover_expired_event_jobs,
  release_event_job_claims,
  run_queue_jobs,
  save_event_job_progress,
  save_event_job_result,
  set_event_jobs_run_id,
} from '@coworker/jobs';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const queue_key = 'test:fencing:one';
const claim_time = new Date('2026-06-06T10:00:00.000Z');
const after_expiry = new Date('2026-06-06T10:01:00.000Z');

describe('event job fencing', () => {
  it('lets exactly one of two racing claimers take a job; the loser cannot finish it', async () => {
    const { db, workspace_id } = await queue_one_job('race');

    const [claim_a, claim_b] = await Promise.all([
      claim(db, workspace_id, 'worker-a', claim_time),
      claim(db, workspace_id, 'worker-b', claim_time),
    ]);
    const winner = [...claim_a, ...claim_b];
    expect(winner).toHaveLength(1);
    const [job] = winner;
    if (!job?.lock_token) throw new Error('Expected a claimed job with a token');

    const loser_finish = await save_event_job_result(db, {
      workspace_id,
      job_ids: [job.job_id],
      lock_token: randomUUID(),
      result: { job_status: 'done' },
    });
    const winner_finish = await save_event_job_result(db, {
      workspace_id,
      job_ids: [job.job_id],
      lock_token: job.lock_token,
      result: { job_status: 'done' },
    });

    expect(loser_finish).toHaveLength(0);
    expect(winner_finish).toMatchObject([{ job_status: 'done', lock_token: null }]);
  });

  it('gives every row of one claim the same token, and a new one on every claim', async () => {
    const { db, workspace_id } = await queue_one_job('batch');
    await enqueue_event_jobs(db, event_input(workspace_id, 'batch-2'));

    const first = await claim(db, workspace_id, 'worker-a', claim_time, 10);
    await recover_expired_event_jobs(db, { now: after_expiry });
    const second = await claim(db, workspace_id, 'worker-b', after_expiry);

    expect(first).toHaveLength(2);
    expect(new Set(first.map((job) => job.lock_token)).size).toBe(1);
    expect(second[0]?.lock_token).toBeTruthy();
    expect(second[0]?.lock_token).not.toBe(first[0]?.lock_token);
  });

  it('stops a stale holder from finishing, failing, extending, or touching a reclaimed job', async () => {
    const { db, workspace_id } = await queue_one_job('stale');
    const [stale_job] = await claim(db, workspace_id, 'worker-a', claim_time, 10);
    await recover_expired_event_jobs(db, { now: after_expiry });
    const [current_job] = await claim(db, workspace_id, 'worker-b', after_expiry);
    if (!stale_job?.lock_token || !current_job?.lock_token) throw new Error('Expected two claims');
    const stale = { workspace_id, job_ids: [stale_job.job_id], lock_token: stale_job.lock_token };

    const stale_writes = await Promise.all([
      save_event_job_result(db, { ...stale, result: { job_status: 'done', run_id: 'run_stale' } }),
      save_event_job_result(db, { ...stale, result: { job_status: 'failed' } }),
      extend_event_job_lock(db, { ...stale, lock_milliseconds: 600_000 }),
      release_event_job_claims(db, stale),
      set_event_jobs_run_id(db, { ...stale, run_id: 'run_stale' }),
      save_event_job_progress(db, {
        ...stale,
        progress: { completed_unit_count: 1, total_unit_count: 2 },
      }),
    ]);
    const stored = await find_job(db, stale_job.job_id);

    expect(stale_writes.map((rows) => rows.length)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(stored).toMatchObject({
      job_status: 'running',
      locked_by: 'worker-b',
      lock_token: current_job.lock_token,
      run_id: null,
      result_data: {},
    });
  });
});

describe('event job interruptions', () => {
  it('counts an expired lease as an interruption and gives the attempt back', async () => {
    const { db, workspace_id } = await queue_one_job('interrupted');
    const [claimed] = await claim(db, workspace_id, 'worker-a', claim_time, 10);

    const [recovered] = await recover_expired_event_jobs(db, { now: after_expiry });

    expect(claimed?.attempt_count).toBe(1);
    expect(recovered).toMatchObject({
      job_status: 'queued',
      attempt_count: 0,
      interruption_count: 1,
      locked_by: null,
      lock_token: null,
    });
  });

  it('sends a job that keeps killing its worker to dead after the interruption cap', async () => {
    const { db, workspace_id } = await queue_one_job('crash-loop');
    await claim(db, workspace_id, 'worker-a', claim_time, 10);
    await recover_expired_event_jobs(db, { now: after_expiry, max_interruptions: 2 });
    await claim(db, workspace_id, 'worker-b', after_expiry, 10);

    const [dead] = await recover_expired_event_jobs(db, {
      now: new Date('2026-06-06T10:02:00.000Z'),
      max_interruptions: 2,
    });

    expect(dead).toMatchObject({
      job_status: 'dead',
      attempt_count: 0,
      interruption_count: 2,
      error_data: { code: 'event_job_interrupted_too_often' },
    });
  });

  it('still spends one attempt when the handler itself fails', async () => {
    const { db, workspace_id, job_id } = await queue_one_job('handler-fails', new Date());
    const failing_handler: EventJobHandler = {
      job_handler: 'test_handler',
      run: async () => {
        throw new Error('The handler broke.');
      },
    };

    await run_queue_jobs(db, { workspace_id, queue_key }, () => failing_handler);
    const stored = await find_job(db, job_id);

    expect(stored).toMatchObject({
      job_status: 'failed',
      attempt_count: 1,
      interruption_count: 0,
      lock_token: null,
      error_data: { message: 'The handler broke.' },
    });
  });
});

describe('lost-lease signal', () => {
  it('aborts the handler signal when the claim is lost, and stops without writing', async () => {
    const { db, workspace_id, job_id } = await queue_one_job('lost-lease', new Date());
    const observed: {
      heartbeat_error?: unknown;
      progress_error?: unknown;
      aborted_before?: boolean;
      aborted_after?: boolean;
      reason?: unknown;
      thief_token?: string | null;
    } = {};
    const handler: EventJobHandler = {
      job_handler: 'test_handler',
      run: async ({ signal, heartbeat, record_progress }) => {
        observed.aborted_before = signal.aborted;
        observed.thief_token = await take_the_job_from_this_worker(db, workspace_id, job_id);
        observed.heartbeat_error = await heartbeat().catch((error: unknown) => error);
        observed.progress_error = await record_progress({
          completed_unit_count: 1,
          total_unit_count: 1,
        }).catch((error: unknown) => error);
        observed.aborted_after = signal.aborted;
        observed.reason = signal.reason;
        return { job_status: 'done', result_data: { written_by: 'the stale holder' } };
      },
    };

    const outcome = await run_queue_jobs(db, { workspace_id, queue_key }, () => handler);
    const stored = await find_job(db, job_id);

    expect(outcome.ran_jobs).toBe(true);
    expect(observed.aborted_before).toBe(false);
    expect(observed.heartbeat_error).toBeInstanceOf(EventJobClaimLostError);
    expect(observed.progress_error).toBeInstanceOf(EventJobClaimLostError);
    expect(observed.aborted_after).toBe(true);
    expect(observed.reason).toBeInstanceOf(EventJobClaimLostError);
    expect(stored).toMatchObject({
      job_status: 'running',
      locked_by: 'worker-thief',
      lock_token: observed.thief_token,
      result_data: {},
    });
  });
});

async function take_the_job_from_this_worker(db: Database, workspace_id: string, job_id: string) {
  const expired = new Date(Date.now() - 1_000);
  await db
    .update(event_jobs)
    .set({ locked_until: expired, last_updated_time: expired, last_updated_by: 'test' })
    .where(eq(event_jobs.job_id, job_id));
  await recover_expired_event_jobs(db);
  const [stolen] = await claim(db, workspace_id, 'worker-thief', new Date());
  return stolen?.lock_token ?? null;
}

async function queue_one_job(source_event_id: string, available_time?: Date) {
  const db = await create_test_database();
  const { workspace_id } = await bootstrap_default_workspace(db);
  const queued = await enqueue_event_jobs(
    db,
    event_input(workspace_id, source_event_id, available_time),
  );
  const job_id = queued.event_jobs[0]?.job_id;
  if (!job_id) throw new Error('Expected one queued job');
  return { db, workspace_id, job_id };
}

function event_input(workspace_id: string, source_event_id: string, available_time?: Date) {
  return {
    workspace_id,
    source: 'test:fencing',
    source_event_id,
    event_type: 'message',
    queue_key,
    actor_key: 'user:test',
    event_jobs: [
      {
        job_handler: 'test_handler',
        available_time: available_time ?? new Date('2026-06-06T09:59:00.000Z'),
      },
    ],
  };
}

function claim(
  db: Database,
  workspace_id: string,
  worker_id: string,
  now: Date,
  lock_milliseconds?: number,
) {
  return claim_ready_event_jobs_for_queue(db, {
    workspace_id,
    queue_key,
    worker_id,
    now,
    ...(lock_milliseconds === undefined ? {} : { lock_milliseconds }),
  });
}

async function find_job(db: Database, job_id: string) {
  return db.query.event_jobs.findFirst({ where: eq(event_jobs.job_id, job_id) });
}
