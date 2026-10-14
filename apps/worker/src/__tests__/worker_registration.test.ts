import { randomUUID } from 'node:crypto';
import { create_rivet_doorbell } from '@api/services/events/rivet_doorbell';
import { env } from '@coworker/config';
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
  find_free_engine_port,
  start_rivet_test_engine,
  type TestEngine,
  test_engine_admin_token,
} from '@worker/__tests__/rivet_test_engine';
import { create_worker_registry, type WorkerRegistry } from '@worker/registry';
import { engine_origin, register_with_rivet } from '@worker/worker_registration';
import type { WorkerServices } from '@worker/worker_services';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

const test_job_handler = 'registration_test_job';
const original_dispatch_mode = env.EVENT_JOB_DISPATCH_MODE;
let engine: TestEngine | undefined;
let registry: WorkerRegistry | undefined;

afterAll(async () => {
  configure_event_job_doorbell(undefined);
  Object.assign(env, { EVENT_JOB_DISPATCH_MODE: original_dispatch_mode });
  await Promise.race([registry?.shutdown(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  await engine?.stop();
}, 30_000);

describe('the worker log line for the engine', () => {
  it('names the engine without its namespace and token', () => {
    const line = engine_origin('https://my-namespace:sk_secret_token@api.rivet.dev/some/path');

    expect(line).toBe('https://api.rivet.dev');
    expect(line).not.toContain('sk_secret_token');
    expect(engine_origin('http://127.0.0.1:27460')).toBe('http://127.0.0.1:27460');
  });
});

describe('worker registration with Rivet', () => {
  it('keeps the process up and registers once the engine answers', async () => {
    Object.assign(env, { EVENT_JOB_DISPATCH_MODE: 'rivet' });
    configure_event_job_doorbell({ ring: () => undefined });
    const port = await find_free_engine_port();
    const connection = {
      endpoint: `http://127.0.0.1:${port}`,
      token: test_engine_admin_token,
      pool: 'default',
    };
    const db = await create_test_database();
    const { workspace_id } = await bootstrap_default_workspace(db);
    const ran: string[] = [];
    const services = create_services(db, ran);
    const waits: number[] = [];
    const logged: string[] = [];
    services.log = { ...services.log, error: (message: string) => void logged.push(message) };

    registry = await register_with_rivet(
      services,
      () => create_worker_registry(services, connection),
      async (ms) => {
        waits.push(ms);
        engine ??= await start_rivet_test_engine(port);
      },
    );

    expect(waits).toEqual([2_000]);
    expect(logged).toEqual([
      'the worker did not register with Rivet (attempt 1); it tries again in 2 s',
    ]);
    const job_id = await enqueue_job(db, workspace_id);
    await create_rivet_doorbell(connection).ring({
      workspace_id,
      queue_key: 'test:registration',
      job_ids: [job_id],
    });
    await wait_for_done(db, job_id);
    expect(ran).toEqual([job_id]);
  }, 90_000);
});

function create_services(db: Database, ran: string[]): WorkerServices {
  const handler: EventJobHandler = {
    job_handler: test_job_handler,
    run: async (input) => {
      ran.push(...input.event_jobs.map((job) => job.job_id));
      return { job_status: 'done' };
    },
  };
  return {
    db,
    find_event_job_handler: (name) => (name === test_job_handler ? handler : null),
    log: create_logger('registration_test'),
    now: () => new Date(),
    rivet_region: undefined,
    rivet_key_scope: 'default',
    rivet_engine: { endpoint: 'http://127.0.0.1:1' },
  };
}

async function enqueue_job(db: Database, workspace_id: string) {
  const result = await queue_and_run_event_jobs(
    db,
    {
      workspace_id,
      source: 'test:registration',
      source_event_id: randomUUID(),
      event_type: 'message',
      queue_key: 'test:registration',
      actor_key: 'user:test',
      event_jobs: [{ job_handler: test_job_handler }],
    },
    () => null,
  );
  const job_id = result.event_jobs[0]?.job_id;
  if (!job_id) throw new Error('Expected one queued job');
  return job_id;
}

async function wait_for_done(db: Database, job_id: string) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [row] = await db.select().from(event_jobs).where(eq(event_jobs.job_id, job_id));
    if (row?.job_status === 'done') return;
    if (Date.now() > deadline) throw new Error(`Job ${job_id} did not finish: ${row?.job_status}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
