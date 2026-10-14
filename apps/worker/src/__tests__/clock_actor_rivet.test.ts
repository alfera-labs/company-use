import { randomUUID } from 'node:crypto';
import { env, type RivetConnection } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { event_jobs, events } from '@coworker/core/db/schema';
import {
  build_clock_key,
  configure_event_job_doorbell,
  create_clock_start,
  type EventJobHandler,
  queue_and_run_event_jobs,
} from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { start_rivet_test_engine, type TestEngine } from '@worker/__tests__/rivet_test_engine';
import { create_clock_actor } from '@worker/clock_actor';
import { create_queue_worker_actor } from '@worker/queue_worker_actor';
import { create_worker_registry, type WorkerRegistry } from '@worker/registry';
import type { WorkerServices } from '@worker/worker_services';
import { eq, like } from 'drizzle-orm';
import { setup } from 'rivetkit';
import { createClient } from 'rivetkit/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const test_job_handler = 'clock_test_job';
const handled: Array<{ job_id: string; locked_by: string | null }> = [];
const test_handler: EventJobHandler = {
  job_handler: test_job_handler,
  run: async (input) => {
    for (const job of input.event_jobs) {
      handled.push({ job_id: job.job_id, locked_by: job.locked_by });
    }
    return { job_status: 'done' };
  },
};
const find_test_handler = (name: string) => (name === test_job_handler ? test_handler : null);
const original_env = {
  EVENT_JOB_DISPATCH_MODE: env.EVENT_JOB_DISPATCH_MODE,
  CONNECTOR_CANARY_APPS: env.CONNECTOR_CANARY_APPS,
};
const log_lines: string[] = [];

let engine: TestEngine;
let db: Database;
let workspace: Awaited<ReturnType<typeof bootstrap_default_workspace>>;
const registries: WorkerRegistry[] = [];

beforeAll(async () => {
  Object.assign(env, { EVENT_JOB_DISPATCH_MODE: 'rivet', CONNECTOR_CANARY_APPS: '' });
  engine = await start_rivet_test_engine();
  db = await create_test_database();
  workspace = await bootstrap_default_workspace(db);
  configure_event_job_doorbell({ ring: () => undefined });
}, 60_000);

afterAll(async () => {
  configure_event_job_doorbell(undefined);
  Object.assign(env, original_env);
  await Promise.all(registries.map(shut_down));
  await engine?.stop();
}, 60_000);

describe('the clock actor on Rivet', () => {
  it('arms no alarm when no work is due', async () => {
    await start_worker(services_for('default'), engine.connection);
    expect(await arm_clock()).toBeNull();
  }, 30_000);

  it('arms one re-check for a queued job, and re-rings it', async () => {
    const client = createClient<WorkerRegistry>(engine.connection);
    const start_clock = create_clock_start(client, {
      key_scope: 'default',
      engine: engine.connection,
    });
    configure_event_job_doorbell({ ring: () => undefined, arm_clock: start_clock });
    const job_id = await enqueue_and_ring(`test:clock_lost:${randomUUID()}`);
    const rung = await db.query.event_jobs.findFirst({ where: eq(event_jobs.job_id, job_id) });
    const recheck_time = (rung?.wake_sent_time?.getTime() ?? 0) + 10_000;
    configure_event_job_doorbell({ ring: () => undefined });

    expect(await arm_clock()).toBe(recheck_time);
    await wait_for_done(job_id, 30_000);
    expect(handled.filter((entry) => entry.job_id === job_id)).toEqual([
      { job_id, locked_by: expect.stringMatching(/^queue_worker:/) },
    ]);
    expect(await arm_clock()).toBeNull();
  }, 60_000);

  it('wakes at each due trigger, fires it once, and re-arms for the next one', async () => {
    const first_time = new Date(Date.now() + 12_000);
    const second_time = new Date(Date.now() + 20_000);
    const first = await create_one_time_task(first_time);
    const second = await create_one_time_task(second_time);
    await arm_clock(Date.now());

    await wait_for_fired(second.trigger_id, 40_000);
    for (const [trigger, due_time] of [
      [first, first_time],
      [second, second_time],
    ] as const) {
      const fire_events = await list_fire_events(trigger.trigger_id);
      expect(fire_events).toHaveLength(1);
      const fired_ms = fire_events[0]?.created_time.getTime() ?? 0;
      expect(fired_ms).toBeGreaterThanOrEqual(due_time.getTime());
      expect(fired_ms).toBeLessThan(due_time.getTime() + 5_000);
    }
  }, 60_000);

  it('refuses a client call to wake: only its own alarm runs it', async () => {
    const client = createClient<WorkerRegistry>(engine.connection);
    const clock = client.clock.getOrCreate(build_clock_key('default'));

    await expect(clock.wake(Date.now())).rejects.toMatchObject({ code: 'forbidden' });
  }, 30_000);

  it('runs one due time once across two clocks that read one database', async () => {
    await Promise.all(registries.splice(0).map(shut_down));
    const [first_scope, second_scope] = ['first_of_two', 'second_of_two'];
    const tick_db = await create_test_database();
    const registry = setup({
      use: {
        queue_worker: create_queue_worker_actor(services_for('default')),
        clock: create_clock_actor(services_for(first_scope, tick_db)),
        second_clock: create_clock_actor(services_for(second_scope, tick_db)),
      },
      endpoint: engine.connection.endpoint,
      envoy: { poolName: engine.connection.pool },
      token: engine.connection.token,
      startEngine: false,
      startServices: false,
      noWelcome: true,
    });
    await registry.startAndWait();
    const client = createClient<typeof registry>(engine.connection);
    const first_line = log_lines.length;
    const due_ms = Date.now() + 3_000;
    await client.clock.getOrCreate(build_clock_key(first_scope)).arm(due_ms);
    await client.second_clock.getOrCreate(build_clock_key(second_scope)).arm(due_ms);

    await new Promise((resolve) => setTimeout(resolve, 8_000));
    await Promise.race([
      registry.shutdown(),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);

    const runs = log_lines
      .slice(first_line)
      .filter((line) => line.startsWith('the clock ran the work due at '));
    expect(runs).toEqual([`the clock ran the work due at ${new Date(due_ms).toISOString()}`]);
  }, 60_000);
});

function services_for(key_scope: string, database: Database = db): WorkerServices {
  return {
    db: database,
    find_event_job_handler: find_test_handler,
    log: {
      ...create_logger(`clock_test_${key_scope}`),
      info: (message: string) => void log_lines.push(message),
    } as WorkerServices['log'],
    now: () => new Date(),
    rivet_region: undefined,
    rivet_key_scope: key_scope,
    rivet_engine: engine.connection,
  };
}

async function start_worker(services: WorkerServices, connection: RivetConnection) {
  const registry = create_worker_registry(services, connection);
  await registry.startAndWait();
  registries.push(registry);
  return registry;
}

async function shut_down(registry: WorkerRegistry) {
  await Promise.race([
    registry.shutdown().catch((error: unknown) => console.warn('ignored in test teardown', error)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
}

function arm_clock(wake_by_ms?: number) {
  const client = createClient<WorkerRegistry>(engine.connection);
  return client.clock.getOrCreate(build_clock_key('default')).arm(wake_by_ms);
}

async function enqueue_and_ring(queue_key: string) {
  const result = await queue_and_run_event_jobs(
    db,
    {
      workspace_id: workspace.workspace_id,
      source: 'test:clock',
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

function create_one_time_task(run_once_at: Date) {
  return create_trigger(db, {
    workspace_id: workspace.workspace_id,
    agent_id: workspace.agent_id,
    trigger_name: 'Clock test task',
    trigger_type: 'schedule',
    schedule_expression: '0 0 1 1 *',
    trigger_config: {
      starts_job_handler: test_job_handler,
      run_once_at: run_once_at.toISOString(),
    },
    actor_id: workspace.user_id,
  });
}

function list_fire_events(trigger_id: string) {
  return db
    .select()
    .from(events)
    .where(like(events.source_event_id, `${trigger_id}:%`));
}

async function wait_for_fired(trigger_id: string, timeout_ms: number) {
  const deadline = Date.now() + timeout_ms;
  while ((await get_trigger_by_id(db, trigger_id))?.last_run_time == null) {
    if (Date.now() > deadline) throw new Error(`Trigger ${trigger_id} never fired`);
    await new Promise((resolve) => setTimeout(resolve, 200));
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
