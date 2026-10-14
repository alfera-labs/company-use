import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { event_jobs } from '@coworker/core/db/schema';
import { type EventJobHandler, event_job_queue_barrier_metadata_key } from '@coworker/jobs';
import { run_queue_jobs } from '@coworker/jobs/event_job_runner';
import { asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const handler_results = {
  barrier_retry_time: new Date('2026-07-11T10:05:00.000Z'),
};

function find_test_event_job_handler(job_handler: string): EventJobHandler | null {
  if (job_handler === 'test_barrier') {
    return {
      job_handler,
      run: async () => ({
        job_status: 'failed' as const,
        retry_at: handler_results.barrier_retry_time,
        retry_counts_as_attempt: false,
      }),
    };
  }
  if (job_handler === 'test_provider_down') {
    return {
      job_handler,
      run: async () => {
        throw new Error('Model provider request error: Connection error.');
      },
    };
  }
  if (job_handler === 'test_later') {
    return { job_handler, run: async () => ({ job_status: 'done' as const }) };
  }
  return null;
}

describe('event job subject barriers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('requeues a retrying barrier and releases later claimed groups without charging attempts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T10:00:00.000Z'));
    const db = await create_test_database();
    const workspace = await bootstrap_default_workspace(db);
    const queue_key = 'slack:T1:C1:thread:1';

    await enqueue_event_jobs(
      db,
      event_input(workspace.workspace_id, queue_key, 'barrier', {
        job_handler: 'test_barrier',
        metadata: { [event_job_queue_barrier_metadata_key]: true },
      }),
    );
    await enqueue_event_jobs(
      db,
      event_input(workspace.workspace_id, queue_key, 'later', {
        job_handler: 'test_later',
      }),
    );

    const result = await run_queue_jobs(
      db,
      {
        workspace_id: workspace.workspace_id,
        queue_key,
        worker_id: 'worker-barrier-test',
      },
      find_test_event_job_handler,
    );
    const rows = await db.query.event_jobs.findMany({
      where: eq(event_jobs.workspace_id, workspace.workspace_id),
      orderBy: (table) => [asc(table.created_time)],
    });

    expect(result.ran_jobs).toBe(true);
    expect(rows).toMatchObject([
      { job_handler: 'test_barrier', job_status: 'queued', attempt_count: 0 },
      { job_handler: 'test_later', job_status: 'queued', attempt_count: 0 },
    ]);
    expect(rows[0]?.available_time).toEqual(handler_results.barrier_retry_time);
  });
});

describe('a provider that could not be reached', () => {
  it('still retries a job that waited 20 minutes before its first failure', async () => {
    const db = await create_test_database();
    const workspace = await bootstrap_default_workspace(db);
    const queue_key = 'slack:T1:C1:thread:provider-down';
    const queued = await enqueue_event_jobs(db, {
      ...event_input(workspace.workspace_id, queue_key, 'provider-down', {
        job_handler: 'test_provider_down',
      }),
      event_jobs: [{ job_handler: 'test_provider_down' }],
    });
    const job_id = queued.event_jobs[0]?.job_id ?? '';
    await db
      .update(event_jobs)
      .set({ created_time: new Date(Date.now() - 20 * 60_000) })
      .where(eq(event_jobs.job_id, job_id));

    await run_queue_jobs(
      db,
      {
        workspace_id: workspace.workspace_id,
        queue_key,
        worker_id: 'worker-provider-down-test',
      },
      find_test_event_job_handler,
    );
    const stored = await db.query.event_jobs.findFirst({ where: eq(event_jobs.job_id, job_id) });

    expect(stored?.job_status).toBe('queued');
    expect(stored?.available_time.getTime()).toBeGreaterThan(Date.now());
    expect(typeof stored?.error_data.first_failure_time).toBe('string');
  });
});

function event_input(
  workspace_id: string,
  queue_key: string,
  source_event_id: string,
  job: { job_handler: string; metadata?: Record<string, unknown> },
) {
  return {
    workspace_id,
    source: 'test',
    source_event_id,
    event_type: 'message',
    queue_key,
    actor_key: 'test:user',
    event_jobs: [{ ...job, available_time: new Date('2026-07-11T09:59:00.000Z') }],
  };
}
