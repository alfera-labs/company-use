import { randomUUID } from 'node:crypto';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { event_jobs } from '@coworker/core/db/schema';
import {
  build_clock_key,
  configure_event_job_doorbell,
  create_clock_start,
  type EventJobHandler,
  queue_and_run_event_jobs,
} from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { start_rivet_test_engine, type TestEngine } from '@worker/__tests__/rivet_test_engine';
import { create_worker_registry, type WorkerRegistry } from '@worker/registry';
import type { WorkerServices } from '@worker/worker_services';
import { eq } from 'drizzle-orm';
import { createClient } from 'rivetkit/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const test_job_handler = 'clock_park_test_job';
const handled: string[] = [];
const test_handler: EventJobHandler = {
  job_handler: test_job_handler,
  run: async (input) => {
    handled.push(...input.event_jobs.map((job) => job.job_id));
    return { job_status: 'done' };
  },
};
const original_env = { EVENT_JOB_DISPATCH_MODE: env.EVENT_JOB_DISPATCH_MODE };

let engine: TestEngine;
let db: Database;
let workspace_id: string;
let registry: WorkerRegistry | undefined;

beforeAll(async () => {
  Object.assign(env, { EVENT_JOB_DISPATCH_MODE: 'rivet' });
  engine = await start_rivet_test_engine();
  db = await create_test_database();
  ({ workspace_id } = await bootstrap_default_workspace(db));
  configure_event_job_doorbell({ ring: () => undefined });
}, 60_000);

afterAll(async () => {
  configure_event_job_doorbell(undefined);
  Object.assign(env, original_env);
  if (registry) await shut_down(registry);
  await engine?.stop();
}, 60_000);

describe('a clock the engine parked', () => {
  it('is re-created on the next start, and its sweep runs again', async () => {
    registry = await start_worker();
    await start_clock();
    await shut_down(registry);
    const clock = createClient<WorkerRegistry>(engine.connection).clock.getOrCreate(
      build_clock_key('default'),
    );
    const parked_actor_id = await clock.resolve();
    await park_for_at_least(clock, parked_actor_id, 60_000);
    registry = await start_worker();
    const job_id = await enqueue_job();

    await start_clock();

    await wait_for_done(job_id, 40_000);
    expect(await clock.resolve()).not.toBe(parked_actor_id);
    expect(handled.filter((id) => id === job_id)).toHaveLength(1);
  }, 150_000);
});

async function start_worker() {
  const services: WorkerServices = {
    db,
    find_event_job_handler: (name) => (name === test_job_handler ? test_handler : null),
    log: create_logger('clock_park_test'),
    now: () => new Date(),
    rivet_region: undefined,
    rivet_key_scope: 'default',
    rivet_engine: engine.connection,
  };
  const started = create_worker_registry(services, engine.connection);
  await started.startAndWait();
  return started;
}

async function shut_down(stopping: WorkerRegistry) {
  await Promise.race([
    stopping.shutdown().catch((error: unknown) => console.warn('ignored in test teardown', error)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
}

function start_clock() {
  const client = createClient<WorkerRegistry>(engine.connection);
  return create_clock_start(client, { key_scope: 'default', engine: engine.connection })();
}

async function enqueue_job() {
  const result = await queue_and_run_event_jobs(
    db,
    {
      workspace_id,
      source: 'test:clock_park',
      source_event_id: randomUUID(),
      event_type: 'message',
      queue_key: `test:clock_park:${randomUUID()}`,
      actor_key: 'user:test',
      event_jobs: [{ job_handler: test_job_handler }],
    },
    (name) => (name === test_job_handler ? test_handler : null),
  );
  const job_id = result.event_jobs[0]?.job_id;
  if (!job_id) throw new Error('Expected one queued job');
  return job_id;
}

async function park_for_at_least(
  clock: { arm(): Promise<unknown> },
  actor_id: string,
  min_ms: number,
) {
  const url = `${engine.connection.endpoint}/actors?namespace=default&actor_ids=${actor_id}`;
  const headers = { authorization: `Bearer ${engine.connection.token}` };
  const deadline = Date.now() + 60_000;
  for (;;) {
    void clock
      .arm()
      .catch((error: unknown) => console.warn('clock arm failed; the loop tries again', error));
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const body = (await (await fetch(url, { headers })).json()) as {
      actors: Array<{ error?: unknown; connectable_ts?: number | null; reschedule_ts?: number }>;
    };
    const [actor] = body.actors;
    const parked_ms = (actor?.reschedule_ts ?? 0) - Date.now();
    if (actor?.error === 'no_envoys' && !actor.connectable_ts && parked_ms >= min_ms) return;
    if (Date.now() > deadline)
      throw new Error(`The clock was not parked: ${JSON.stringify(actor)}`);
  }
}

async function wait_for_done(job_id: string, timeout_ms: number) {
  const deadline = Date.now() + timeout_ms;
  for (;;) {
    const row = await db.query.event_jobs.findFirst({ where: eq(event_jobs.job_id, job_id) });
    if (row?.job_status === 'done') return row;
    if (Date.now() > deadline) throw new Error(`Job ${job_id} is not done: ${JSON.stringify(row)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
