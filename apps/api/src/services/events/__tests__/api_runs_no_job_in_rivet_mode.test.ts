import { randomUUID } from 'node:crypto';
import { create_app } from '@api/app';
import { recover_stuck_jobs_and_run_ready_queues } from '@api/services/events/event_job_recovery';
import { create_rivet_doorbell } from '@api/services/events/rivet_doorbell';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { event_jobs } from '@coworker/core/db/schema';
import {
  configure_event_job_doorbell,
  type EventJobHandler,
  JobRunOutsideQueueWorkerError,
  queue_and_run_event_jobs,
  run_next_ready_queue_jobs,
  run_queue_jobs,
  run_queue_jobs_in_the_background,
} from '@coworker/jobs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const test_job_handler = 'api_must_not_run_this';
const handled: string[] = [];
const test_handler: EventJobHandler = {
  job_handler: test_job_handler,
  run: async (input) => {
    handled.push(...input.event_jobs.map((job) => job.job_id));
    return { job_status: 'done' };
  },
};
const find_test_handler = (name: string) => (name === test_job_handler ? test_handler : null);
const original_env = {
  EVENT_JOB_DISPATCH_MODE: env.EVENT_JOB_DISPATCH_MODE,
  COWORKER_API_PROXY_SECRET: env.COWORKER_API_PROXY_SECRET,
};
const unreachable_engine = {
  endpoint: 'http://127.0.0.1:1',
  namespace: 'default',
  token: 'admin',
  pool: 'default',
};

let db: Database;
let workspace_id: string;

beforeAll(async () => {
  Object.assign(env, { EVENT_JOB_DISPATCH_MODE: 'rivet' });
  configure_event_job_doorbell(create_rivet_doorbell(unreachable_engine));
  db = await create_test_database();
  ({ workspace_id } = await bootstrap_default_workspace(db));
});

afterAll(() => {
  configure_event_job_doorbell(undefined);
  Object.assign(env, original_env);
});

describe('the API in rivet mode', () => {
  it('queues and rings, and runs nothing when the ring fails', async () => {
    const job_id = await enqueue_job(`test:api_rivet:${randomUUID()}`);

    await new Promise((resolve) => setTimeout(resolve, 16_000));

    const row = await read_job(job_id);
    expect(row?.job_status).toBe('queued');
    expect(row?.locked_by).toBeNull();
    expect(row?.wake_sent_time).not.toBeNull();
    expect(handled).not.toContain(job_id);
  }, 25_000);

  it('rings for follow-up work and runs nothing when that ring fails', async () => {
    const queue_key = `test:api_rivet_follow_up:${randomUUID()}`;
    const job_id = await enqueue_job(queue_key);

    run_queue_jobs_in_the_background(db, { workspace_id, queue_key }, find_test_handler);
    await new Promise((resolve) => setTimeout(resolve, 16_000));

    expect((await read_job(job_id))?.job_status).toBe('queued');
    expect(handled).not.toContain(job_id);
  }, 25_000);

  it('refuses every claim the job runner is asked for in this process', async () => {
    const queue_key = `test:api_rivet_claim:${randomUUID()}`;
    const job_id = await enqueue_job(queue_key);

    await expect(
      run_queue_jobs(db, { workspace_id, queue_key }, find_test_handler),
    ).rejects.toBeInstanceOf(JobRunOutsideQueueWorkerError);
    await expect(
      run_next_ready_queue_jobs(db, { worker_id: 'api' }, find_test_handler),
    ).rejects.toBeInstanceOf(JobRunOutsideQueueWorkerError);
    await expect(recover_stuck_jobs_and_run_ready_queues(db)).rejects.toBeInstanceOf(
      JobRunOutsideQueueWorkerError,
    );

    expect((await read_job(job_id))?.job_status).toBe('queued');
    expect(handled).not.toContain(job_id);
  });

  it('answers the old recovery route with 409 and runs nothing', async () => {
    Object.assign(env, { COWORKER_API_PROXY_SECRET: 'rivet-mode-test-secret' });
    const job_id = await enqueue_job(`test:api_rivet_route:${randomUUID()}`);
    const app = create_app(db);

    const responses = await Promise.all(
      [{}, { run_recovery: true }].map((body) =>
        app.request('/internal/run-queued-jobs', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-coworker-api-secret': 'rivet-mode-test-secret',
          },
          body: JSON.stringify(body),
        }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([409, 409]);
    expect((await read_job(job_id))?.job_status).toBe('queued');
    expect(handled).not.toContain(job_id);
  });
});

async function enqueue_job(queue_key: string) {
  const result = await queue_and_run_event_jobs(
    db,
    {
      workspace_id,
      source: 'test:api_rivet',
      source_event_id: randomUUID(),
      event_type: 'message',
      queue_key,
      actor_key: 'user:test',
      event_jobs: [{ job_handler: test_job_handler }],
    },
    find_test_handler,
  );
  const job_id = result.event_jobs[0]?.job_id;
  if (!job_id) throw new Error('Expected one queued job');
  return job_id;
}

function read_job(job_id: string) {
  return db.query.event_jobs.findFirst({ where: eq(event_jobs.job_id, job_id) });
}
