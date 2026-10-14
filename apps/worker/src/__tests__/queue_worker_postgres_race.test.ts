import { randomUUID } from 'node:crypto';
import { create_rivet_doorbell } from '@api/services/events/rivet_doorbell';
import { env } from '@coworker/config';
import { create_database } from '@coworker/core/db/connection';
import { event_jobs, events, workspaces } from '@coworker/core/db/schema';
import {
  configure_event_job_doorbell,
  type EventJobHandler,
  queue_and_run_event_jobs,
  run_next_ready_queue_jobs,
} from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { start_rivet_test_engine, type TestEngine } from '@worker/__tests__/rivet_test_engine';
import { create_worker_registry, type WorkerRegistry } from '@worker/registry';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const database_url = process.env.DATABASE_URL;
if (process.env.COWORKER_REQUIRE_POSTGRES_TESTS === 'true' && !database_url) {
  throw new Error(
    'COWORKER_REQUIRE_POSTGRES_TESTS is set but DATABASE_URL is not — the queue worker race test cannot run',
  );
}

const test_job_handler = 'rivet_postgres_race_job';
const job_count = 12;
const original_env = { EVENT_JOB_DISPATCH_MODE: env.EVENT_JOB_DISPATCH_MODE };
const handled: Array<{ job_id: string; locked_by: string | null }> = [];
const test_handler: EventJobHandler = {
  job_handler: test_job_handler,
  run: async (input) => {
    for (const job of input.event_jobs) {
      handled.push({ job_id: job.job_id, locked_by: job.locked_by });
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { job_status: 'done' };
  },
};
const find_test_handler = (name: string) => (name === test_job_handler ? test_handler : null);

const workspace_id = `ws_race_${randomUUID().slice(0, 8)}`;
let engine: TestEngine | undefined;
let registry: WorkerRegistry | undefined;
let worker_db: ReturnType<typeof create_database>;
let api_db: ReturnType<typeof create_database>;

describe.skipIf(!database_url)('queue worker and a second drainer on real Postgres', () => {
  beforeAll(async () => {
    Object.assign(env, { EVENT_JOB_DISPATCH_MODE: 'rivet' });
    worker_db = create_database(database_url);
    api_db = create_database(database_url);
    await api_db.insert(workspaces).values({
      workspace_id,
      workspace_name: 'Queue worker race test',
      workspace_slug: workspace_id,
      created_by: 'system:test',
      last_updated_by: 'system:test',
    });
    engine = await start_rivet_test_engine();
    registry = create_worker_registry(
      {
        db: worker_db,
        find_event_job_handler: find_test_handler,
        log: create_logger('worker_race_test'),
        now: () => new Date(),
        rivet_region: undefined,
        rivet_key_scope: 'default',
        rivet_engine: engine.connection,
      },
      engine.connection,
    );
    await registry.startAndWait();
    configure_event_job_doorbell(create_rivet_doorbell(engine.connection));
  }, 60_000);

  afterAll(async () => {
    configure_event_job_doorbell(undefined);
    Object.assign(env, original_env);
    await Promise.race([
      registry?.shutdown(),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
    await engine?.stop();
    if (!api_db) return;
    await api_db.delete(event_jobs).where(eq(event_jobs.workspace_id, workspace_id));
    await api_db.delete(events).where(eq(events.workspace_id, workspace_id));
    await api_db.delete(workspaces).where(eq(workspaces.workspace_id, workspace_id));
    await Promise.all([close_pool(worker_db), close_pool(api_db)]);
  }, 30_000);

  it('runs each job exactly once while both drain the same queues', async () => {
    const queue_keys = Array.from(
      { length: 3 },
      (_, index) => `test:pg_race:${index}:${randomUUID()}`,
    );
    const doorbell = create_rivet_doorbell(engine?.connection ?? missing_engine());
    for (const queue_key of queue_keys)
      doorbell.ring({ workspace_id, queue_key, job_ids: ['none'] });
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const job_ids: string[] = [];
    const second_claims: Promise<unknown>[] = [];
    for (let index = 0; index < job_count; index += 1) {
      job_ids.push(await enqueue_job(queue_keys[index % queue_keys.length] ?? ''));
      second_claims.push(claim_like_a_second_drainer());
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await Promise.all(second_claims);
    const ring_test_queues = () => {
      for (const queue_key of queue_keys)
        doorbell.ring({ workspace_id, queue_key, job_ids: ['sweep'] });
    };
    await wait_for_all_done(job_ids, 20_000, ring_test_queues);

    for (const job_id of job_ids) {
      expect(handled.filter((entry) => entry.job_id === job_id)).toHaveLength(1);
    }
    const winners = handled.map((entry) => entry.locked_by?.split(':')[0]);
    expect(new Set(winners)).toEqual(new Set(['queue_worker', 'second_drain']));
  }, 40_000);
});

function claim_like_a_second_drainer() {
  return run_next_ready_queue_jobs(
    api_db,
    { workspace_id, worker_id: `second_drain:${randomUUID()}` },
    find_test_handler,
  );
}

async function enqueue_job(queue_key: string) {
  const result = await queue_and_run_event_jobs(
    api_db,
    {
      workspace_id,
      source: 'test:pg_race',
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

async function wait_for_all_done(job_ids: string[], timeout_ms: number, sweep: () => void) {
  const deadline = Date.now() + timeout_ms;
  let next_sweep_time = Date.now() + 1_000;
  for (;;) {
    if (Date.now() > next_sweep_time) {
      sweep();
      next_sweep_time = Date.now() + 1_000;
    }
    const rows = await api_db
      .select({ job_status: event_jobs.job_status })
      .from(event_jobs)
      .where(inArray(event_jobs.job_id, job_ids));
    if (rows.length === job_ids.length && rows.every((row) => row.job_status === 'done')) return;
    if (Date.now() > deadline) throw new Error(`Jobs did not finish: ${JSON.stringify(rows)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function close_pool(db: ReturnType<typeof create_database> | undefined) {
  return db?.$client.end();
}

function missing_engine(): never {
  throw new Error('The test Rivet Engine did not start.');
}
