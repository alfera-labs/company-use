import { randomUUID } from 'node:crypto';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_database, type Database } from '@coworker/core/db/connection';
import { claim_scheduler_tick } from '@coworker/core/db/queries/scheduler_ticks';
import { scheduler_ticks } from '@coworker/core/db/schema';
import { configure_event_job_doorbell } from '@coworker/jobs';
import { find_event_job_handler } from '@coworker/runtime-platform';
import { create_logger } from '@coworker/shared';
import { run_clock_work } from '@worker/clock_work';
import type { WorkerServices } from '@worker/worker_services';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const original_env = { EVENT_JOB_DISPATCH_MODE: env.EVENT_JOB_DISPATCH_MODE };
const first_minute = new Date('2026-09-26T10:00:00.000Z');

beforeEach(() => {
  Object.assign(env, { EVENT_JOB_DISPATCH_MODE: 'rivet' });
  configure_event_job_doorbell({ ring: () => undefined });
});

afterEach(() => {
  Object.assign(env, original_env);
  configure_event_job_doorbell(undefined);
});

describe('clock work without a Rivet Engine', () => {
  it('runs each due time once across two clocks', async () => {
    const db = await create_test_database();
    const processes = [create_services(db), create_services(db)];
    const runs_per_due_time: number[] = [];

    for (const offset_seconds of [5, 15, 125]) {
      const due_time = new Date(first_minute.getTime() + offset_seconds * 1000);
      const runs = processes.flatMap((services) =>
        [1, 2, 3].map(() => run_clock_work(services, ring_nothing, due_time)),
      );
      runs_per_due_time.push((await Promise.all(runs)).filter(Boolean).length);
    }

    expect(runs_per_due_time).toEqual([1, 1, 1]);
    const earlier = new Date(first_minute.getTime() + 70_000);
    expect(await run_clock_work(processes[0] as WorkerServices, ring_nothing, earlier)).toBe(false);
  });
});

const database_url = process.env.DATABASE_URL;
if (process.env.COWORKER_REQUIRE_POSTGRES_TESTS === 'true' && !database_url) {
  throw new Error('COWORKER_REQUIRE_POSTGRES_TESTS is set but DATABASE_URL is not');
}

describe.skipIf(!database_url)('clock work claim on real Postgres', () => {
  it('gives each due time to exactly one of many concurrent claims', async () => {
    const pools = [create_database(database_url), create_database(database_url)];
    const tick_name = `test_clock_work_${randomUUID()}`;
    try {
      const claims_per_minute: number[] = [];
      for (const minute of [0, 1, 2]) {
        const tick_time = new Date(first_minute.getTime() + minute * 60_000);
        const claims = pools.flatMap((db, pool_index) =>
          Array.from({ length: 10 }, () =>
            claim_scheduler_tick(db, { tick_name, tick_time, actor_id: `test:pool_${pool_index}` }),
          ),
        );
        claims_per_minute.push((await Promise.all(claims)).filter(Boolean).length);
      }
      expect(claims_per_minute).toEqual([1, 1, 1]);
    } finally {
      await pools[0]?.delete(scheduler_ticks).where(eq(scheduler_ticks.tick_name, tick_name));
      await Promise.all(pools.map(close_pool));
    }
  }, 30_000);
});

const ring_nothing = async () => undefined;

function create_services(db: Database): WorkerServices {
  return {
    db,
    find_event_job_handler,
    log: create_logger('clock_work_test'),
    now: () => new Date(),
    rivet_region: undefined,
    rivet_key_scope: 'default',
    rivet_engine: { endpoint: 'http://127.0.0.1:1' },
  };
}

function close_pool(db: ReturnType<typeof create_database> | undefined) {
  return db?.$client.end();
}
