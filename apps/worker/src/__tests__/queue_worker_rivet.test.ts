import { randomUUID } from 'node:crypto';
import {
  create_rivet_clock_start,
  create_rivet_doorbell,
} from '@api/services/events/rivet_doorbell';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import type { QueueEventJobInput } from '@coworker/core/db/queries/events';
import { event_jobs } from '@coworker/core/db/schema';
import {
  build_clock_key,
  configure_event_job_doorbell,
  type Doorbell,
  type DoorbellRing,
  type EventJobHandler,
  queue_and_run_event_jobs,
  run_next_ready_queue_jobs,
} from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { start_rivet_test_engine, type TestEngine } from '@worker/__tests__/rivet_test_engine';
import { stale_wake_seconds, sweep_queues } from '@worker/queue_sweep';
import { create_worker_registry, type WorkerRegistry } from '@worker/registry';
import type { WorkerServices } from '@worker/worker_services';
import { eq } from 'drizzle-orm';
import { createClient } from 'rivetkit/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const test_job_handler = 'rivet_test_job';
const paired_job_handler = 'rivet_test_paired_job';
const original_env = {
  EVENT_JOB_DISPATCH_MODE: env.EVENT_JOB_DISPATCH_MODE,
  WORKER_MAX_CONCURRENT_RUNS: env.WORKER_MAX_CONCURRENT_RUNS,
};
const handled: Array<{ job_id: string; locked_by: string | null }> = [];
let handler_delay_ms = 0;
let paired_jobs_started = 0;

const test_handler: EventJobHandler = {
  job_handler: test_job_handler,
  run: async (input) => {
    for (const job of input.event_jobs)
      handled.push({ job_id: job.job_id, locked_by: job.locked_by });
    await new Promise((resolve) => setTimeout(resolve, handler_delay_ms));
    return { job_status: 'done' };
  },
};
const paired_handler: EventJobHandler = {
  job_handler: paired_job_handler,
  run: async () => {
    paired_jobs_started += 1;
    const deadline = Date.now() + 5_000;
    while (paired_jobs_started < 2) {
      if (Date.now() > deadline) return { job_status: 'failed', error_message: 'ran alone' };
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { job_status: 'done' };
  },
};
const test_handlers = new Map([
  [test_job_handler, test_handler],
  [paired_job_handler, paired_handler],
]);
const find_test_handler = (name: string) => test_handlers.get(name) ?? null;

let engine: TestEngine;
let registry: WorkerRegistry;
let db: Database;
let workspace_id: string;
let services: WorkerServices;

beforeAll(async () => {
  Object.assign(env, { EVENT_JOB_DISPATCH_MODE: 'rivet', WORKER_MAX_CONCURRENT_RUNS: 1 });
  engine = await start_rivet_test_engine();
  db = await create_test_database();
  ({ workspace_id } = await bootstrap_default_workspace(db));
  services = {
    db,
    find_event_job_handler: find_test_handler,
    log: create_logger('worker_test'),
    now: () => new Date(),
    rivet_region: undefined,
    rivet_key_scope: 'default',
    rivet_engine: engine.connection,
  };
  registry = create_worker_registry(services, engine.connection);
  await registry.startAndWait();
  const client = createClient<WorkerRegistry>(engine.connection);
  await client.clock.getOrCreate(build_clock_key('default')).arm();
}, 60_000);

afterAll(async () => {
  configure_event_job_doorbell(undefined);
  Object.assign(env, original_env);
  await Promise.race([registry?.shutdown(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  await engine?.stop();
}, 30_000);

describe('queue worker on Rivet', () => {
  it('runs an enqueued job on the queue worker after the API rings', async () => {
    const rings = use_real_doorbell();
    const queue_key = `test:e2e:${randomUUID()}`;
    const job_id = await enqueue_job(queue_key);

    await wait_for_job_status(job_id, 'done', 10_000);

    expect(rings).toContainEqual({ workspace_id, queue_key, job_ids: [job_id] });
    expect(handlers_for(job_id)).toEqual([
      { job_id, locked_by: expect.stringMatching(/^queue_worker:/) },
    ]);
  });

  it('runs a job whose ring was lost once the clock sweep rings again', async () => {
    const dropped: DoorbellRing[] = [];
    configure_event_job_doorbell(with_clock({ ring: (ring) => void dropped.push(ring) }));
    const job_id = await enqueue_job(`test:lost:${randomUUID()}`);
    const rung = await wait_for_row(job_id, (row) => row.wake_sent_time !== null, 5_000);
    expect(rung.job_status).toBe('queued');

    const started = Date.now();
    await wait_for_job_status(job_id, 'done', 30_000);

    expect(dropped.map((ring) => ring.job_ids)).toContainEqual([job_id]);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(handlers_for(job_id)).toEqual([
      { job_id, locked_by: expect.stringMatching(/^queue_worker:/) },
    ]);
  }, 40_000);

  it('runs two queues at once in one worker process with the default worker cap', async () => {
    use_real_doorbell();
    expect(env.QUEUE_WORKER_MAX_CONCURRENT_RUNS).toBe(8);
    const job_ids = await Promise.all([
      enqueue_job(`test:pair:${randomUUID()}`, { job_handler: paired_job_handler }),
      enqueue_job(`test:pair:${randomUUID()}`, { job_handler: paired_job_handler }),
    ]);

    const rows = await Promise.all(
      job_ids.map((job_id) =>
        wait_for_row(
          job_id,
          (row) => row.job_status !== 'queued' && row.job_status !== 'running',
          15_000,
        ),
      ),
    );

    expect(rows.map((row) => row.job_status)).toEqual(['done', 'done']);
  }, 30_000);

  it('drains jobs queued during a run on the same wake and sends itself no extra wake', async () => {
    const queue_key = `test:drain:${randomUUID()}`;
    const enqueue_rings: DoorbellRing[] = [];
    configure_event_job_doorbell({ ring: (ring) => void enqueue_rings.push(ring) });
    handler_delay_ms = 1_000;
    const first_job_id = await enqueue_job(queue_key);
    await wait_until(() => enqueue_rings.length === 1, 5_000);

    create_rivet_doorbell(engine.connection).ring({
      workspace_id,
      queue_key,
      job_ids: [first_job_id],
    });
    await wait_for_job_status(first_job_id, 'running', 5_000);
    const later_job_ids = [await enqueue_job(queue_key), await enqueue_job(queue_key)];
    await wait_until(() => enqueue_rings.length === 3, 5_000);
    handler_delay_ms = 0;
    const worker_rings = use_real_doorbell();

    const job_ids = [first_job_id, ...later_job_ids];
    await Promise.all(job_ids.map((job_id) => wait_for_job_status(job_id, 'done', 10_000)));
    await new Promise((resolve) => setTimeout(resolve, 500));

    for (const job_id of job_ids) expect(handlers_for(job_id)).toHaveLength(1);
    expect(worker_rings.filter((ring) => ring.queue_key === queue_key)).toEqual([]);
  }, 20_000);

  it('runs each job exactly once when a second drain races the queue worker', async () => {
    use_real_doorbell();
    handler_delay_ms = 300;
    const job_ids = await Promise.all(
      Array.from({ length: 5 }, () => enqueue_job(`test:race:${randomUUID()}`)),
    );
    await Promise.all(
      job_ids.map(() =>
        run_next_ready_queue_jobs(
          db,
          { worker_id: `second_drain:${randomUUID()}` },
          find_test_handler,
        ),
      ),
    );
    await Promise.all(job_ids.map((job_id) => wait_for_job_status(job_id, 'done', 15_000)));
    handler_delay_ms = 0;

    for (const job_id of job_ids) expect(handlers_for(job_id)).toHaveLength(1);
  }, 30_000);

  it('leaves the job queued when the ring fails, and the clock rings it again', async () => {
    configure_event_job_doorbell(
      with_clock({
        ring: () => Promise.reject(new Error('The Rivet engine did not answer within 2000 ms.')),
      }),
    );
    const job_id = await enqueue_job(`test:ring_failed:${randomUUID()}`);

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const waiting = await wait_for_row(job_id, () => true, 1_000);
    expect(waiting.job_status).toBe('queued');
    expect(waiting.locked_by).toBeNull();

    await wait_for_job_status(job_id, 'done', 30_000);
    expect(handlers_for(job_id)).toEqual([
      { job_id, locked_by: expect.stringMatching(/^queue_worker:/) },
    ]);
  }, 40_000);

  it('runs each job exactly once when a ring arrives but reports a failure', async () => {
    const doorbell = create_rivet_doorbell(engine.connection);
    configure_event_job_doorbell({
      ring: async (ring) => {
        await doorbell.ring(ring);
        throw new Error('The Rivet engine did not answer within 2000 ms.');
      },
    });
    handler_delay_ms = 300;
    const job_ids = await Promise.all(
      Array.from({ length: 5 }, () => enqueue_job(`test:ring_race:${randomUUID()}`)),
    );
    await Promise.all(job_ids.map((job_id) => wait_for_job_status(job_id, 'done', 15_000)));
    handler_delay_ms = 0;

    for (const job_id of job_ids) expect(handlers_for(job_id)).toHaveLength(1);
  }, 30_000);

  it('leaves a queue the sweep cannot ring queued, for the next sweep', async () => {
    const dropped: DoorbellRing[] = [];
    configure_event_job_doorbell(with_clock({ ring: (ring) => void dropped.push(ring) }));
    const job_id = await enqueue_job(`test:sweep_failed:${randomUUID()}`);
    await wait_for_row(job_id, (row) => row.wake_sent_time !== null, 5_000);
    const failing_ring = () => Promise.reject(new Error('The Rivet engine did not answer.'));
    const later = () => new Date(Date.now() + (stale_wake_seconds + 1) * 1000);

    const swept = await sweep_queues({ ...services, now: later }, failing_ring);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(swept.rung_queues).toBe(0);
    expect((await wait_for_row(job_id, () => true, 1_000)).job_status).toBe('queued');
    expect(handlers_for(job_id)).toEqual([]);
    await wait_for_job_status(job_id, 'done', 30_000);
    expect(handlers_for(job_id)).toEqual([
      { job_id, locked_by: expect.stringMatching(/^queue_worker:/) },
    ]);
  }, 40_000);
});

function with_clock(doorbell: Doorbell): Doorbell {
  return { ...doorbell, arm_clock: create_rivet_clock_start(engine.connection) };
}

function use_real_doorbell() {
  const rings: DoorbellRing[] = [];
  const doorbell = create_rivet_doorbell(engine.connection);
  configure_event_job_doorbell({
    ring: (ring) => {
      rings.push(ring);
      doorbell.ring(ring);
    },
  });
  return rings;
}

async function enqueue_job(
  queue_key: string,
  job: QueueEventJobInput = { job_handler: test_job_handler },
) {
  const result = await queue_and_run_event_jobs(
    db,
    {
      workspace_id,
      source: 'test:rivet',
      source_event_id: randomUUID(),
      event_type: 'message',
      queue_key,
      actor_key: 'user:test',
      event_jobs: [job],
    },
    find_test_handler,
  );
  const job_id = result.event_jobs[0]?.job_id;
  if (!job_id) throw new Error('Expected one queued job');
  return job_id;
}

function handlers_for(job_id: string) {
  return handled.filter((entry) => entry.job_id === job_id);
}

async function wait_for_job_status(job_id: string, job_status: string, timeout_ms: number) {
  return wait_for_row(job_id, (row) => row.job_status === job_status, timeout_ms);
}

async function wait_for_row(
  job_id: string,
  is_ready: (row: typeof event_jobs.$inferSelect) => boolean,
  timeout_ms: number,
) {
  const deadline = Date.now() + timeout_ms;
  for (;;) {
    const [row] = await db.select().from(event_jobs).where(eq(event_jobs.job_id, job_id));
    if (row && is_ready(row)) return row;
    if (Date.now() > deadline) {
      throw new Error(`Job ${job_id} did not reach the expected state: ${JSON.stringify(row)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function wait_until(is_true: () => boolean, timeout_ms: number) {
  const deadline = Date.now() + timeout_ms;
  while (!is_true()) {
    if (Date.now() > deadline) throw new Error('The condition did not become true in time.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
