import { randomUUID } from 'node:crypto';
import { create_rivet_doorbell } from '@api/services/events/rivet_doorbell';
import { env, type RivetConnection } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { event_jobs } from '@coworker/core/db/schema';
import {
  configure_event_job_doorbell,
  type EventJobHandler,
  queue_and_run_event_jobs,
} from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import {
  start_rivet_test_engine,
  type TestEngine,
  upsert_normal_runner_config,
} from '@worker/__tests__/rivet_test_engine';
import { create_queue_worker_ring } from '@worker/queue_worker_ring';
import { create_worker_registry, type WorkerRegistry } from '@worker/registry';
import { eq } from 'drizzle-orm';
import { createClient } from 'rivetkit/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const test_job_handler = 'key_scope_test_job';
type Side = {
  key_scope: string;
  connection: RivetConnection;
  db: Database;
  workspace_id: string;
  ran: Array<{ job_id: string; locked_by: string | null }>;
};

const original_dispatch_mode = env.EVENT_JOB_DISPATCH_MODE;
let engine: TestEngine;
let registry: WorkerRegistry;
let side_a: Side;
let side_b: Side;

beforeAll(async () => {
  Object.assign(env, { EVENT_JOB_DISPATCH_MODE: 'rivet' });
  configure_event_job_doorbell({ ring: () => undefined });
  engine = await start_rivet_test_engine();
  side_a = await create_side('pool_a');
  side_b = await create_side('pool_b');
  const handler = record_runs(side_a);
  registry = create_worker_registry(
    {
      db: side_a.db,
      find_event_job_handler: (name) => (name === test_job_handler ? handler : null),
      log: create_logger('key_scope_test'),
      now: () => new Date(),
      rivet_region: undefined,
      rivet_key_scope: side_a.key_scope,
      rivet_engine: side_a.connection,
    },
    side_a.connection,
  );
  await registry.startAndWait();
}, 60_000);

afterAll(async () => {
  configure_event_job_doorbell(undefined);
  Object.assign(env, { EVENT_JOB_DISPATCH_MODE: original_dispatch_mode });
  await Promise.race([registry?.shutdown(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  await engine?.stop();
}, 30_000);

describe('queue worker key scope on one shared engine', () => {
  it('never lets a ring for scope B wake the worker of scope A', async () => {
    expect(side_a.workspace_id).toBe(side_b.workspace_id);
    const queue_key = `test:shared:${randomUUID()}`;
    const first_job_a = await enqueue_job(side_a, queue_key);
    await ring(side_a, queue_key, first_job_a);
    await wait_for_job_status(side_a, first_job_a, 'done');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const waiting_job_a = await enqueue_job(side_a, queue_key);
    const job_b = await enqueue_job(side_b, queue_key);

    await expect(ring(side_b, queue_key, job_b)).rejects.toThrow('did not answer within 15000 ms');
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(await read_job_status(side_a, waiting_job_a)).toBe('queued');
    expect(await read_job_status(side_b, job_b)).toBe('queued');
    expect(side_a.ran.map((entry) => entry.job_id)).toEqual([first_job_a]);
    await ring(side_a, queue_key, waiting_job_a);
    await wait_for_job_status(side_a, waiting_job_a, 'done');
    expect(side_a.ran).toEqual([
      { job_id: first_job_a, locked_by: expect.stringMatching(/^queue_worker:/) },
      { job_id: waiting_job_a, locked_by: expect.stringMatching(/^queue_worker:/) },
    ]);
  }, 30_000);

  it('refuses a key of another scope, so worker A never drains for scope B', async () => {
    const queue_key = `test:foreign:${randomUUID()}`;
    const job_a = await enqueue_job(side_a, queue_key);
    const misrouted_ring = create_queue_worker_ring(lookup_for(side_a), {
      rivet_region: undefined,
      rivet_key_scope: side_b.key_scope,
      rivet_engine: side_a.connection,
    });

    await expect(
      misrouted_ring({ workspace_id: side_a.workspace_id, queue_key, job_id: job_a }),
    ).rejects.toMatchObject({ code: 'queue_worker_key_refused' });

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await read_job_status(side_a, job_a)).toBe('queued');
    expect(side_a.ran.map((entry) => entry.job_id)).not.toContain(job_a);
  }, 30_000);
});

async function create_side(key_scope: string): Promise<Side> {
  const connection = { ...engine.connection, pool: key_scope };
  await upsert_normal_runner_config(connection, key_scope);
  const db = await create_test_database();
  const { workspace_id } = await bootstrap_default_workspace(db);
  return { key_scope, connection, db, workspace_id, ran: [] };
}

function record_runs(side: Side): EventJobHandler {
  return {
    job_handler: test_job_handler,
    run: async (input) => {
      for (const job of input.event_jobs) {
        side.ran.push({ job_id: job.job_id, locked_by: job.locked_by });
      }
      return { job_status: 'done' };
    },
  };
}

function lookup_for(side: Side) {
  return createClient<WorkerRegistry>({
    endpoint: side.connection.endpoint,
    token: side.connection.token,
    poolName: side.connection.pool,
  });
}

function ring(side: Side, queue_key: string, job_id: string) {
  return create_rivet_doorbell(side.connection).ring({
    workspace_id: side.workspace_id,
    queue_key,
    job_ids: [job_id],
  });
}

async function enqueue_job(side: Side, queue_key: string) {
  const result = await queue_and_run_event_jobs(
    side.db,
    {
      workspace_id: side.workspace_id,
      source: 'test:key_scope',
      source_event_id: randomUUID(),
      event_type: 'message',
      queue_key,
      actor_key: 'user:test',
      event_jobs: [{ job_handler: test_job_handler }],
    },
    () => null,
  );
  const job_id = result.event_jobs[0]?.job_id;
  if (!job_id) throw new Error('Expected one queued job');
  return job_id;
}

async function read_job_status(side: Side, job_id: string) {
  const [row] = await side.db.select().from(event_jobs).where(eq(event_jobs.job_id, job_id));
  return row?.job_status;
}

async function wait_for_job_status(side: Side, job_id: string, job_status: string) {
  const deadline = Date.now() + 10_000;
  while ((await read_job_status(side, job_id)) !== job_status) {
    if (Date.now() > deadline) throw new Error(`Job ${job_id} did not reach ${job_status}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
