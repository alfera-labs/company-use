import { randomUUID } from 'node:crypto';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  configure_event_job_doorbell,
  type EventJobHandler,
  queue_and_run_event_jobs,
} from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { start_rivet_test_engine, type TestEngine } from '@worker/__tests__/rivet_test_engine';
import { create_queue_worker_ring } from '@worker/queue_worker_ring';
import { start_registration_watch } from '@worker/registration_watch';
import { create_worker_registry, type WorkerRegistry } from '@worker/registry';
import { register_with_rivet } from '@worker/worker_registration';
import type { WorkerServices } from '@worker/worker_services';
import { createClient } from 'rivetkit/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const test_job_handler = 'registration_test_job';
const handled: Array<{ job_id: string; locked_by: string | null }> = [];
const test_handler: EventJobHandler = {
  job_handler: test_job_handler,
  run: async (input) => {
    for (const job of input.event_jobs)
      handled.push({ job_id: job.job_id, locked_by: job.locked_by });
    return { job_status: 'done' };
  },
};
const original_dispatch_mode = env.EVENT_JOB_DISPATCH_MODE;
const fast_timing = { check_interval_ms: 1_000, lost_budget_ms: 5_000 };

let engine: TestEngine;
let db: Database;
let workspace_id: string;

beforeAll(async () => {
  Object.assign(env, { EVENT_JOB_DISPATCH_MODE: 'rivet' });
  engine = await start_rivet_test_engine();
  db = await create_test_database();
  ({ workspace_id } = await bootstrap_default_workspace(db));
}, 60_000);

afterAll(async () => {
  configure_event_job_doorbell(undefined);
  Object.assign(env, { EVENT_JOB_DISPATCH_MODE: original_dispatch_mode });
  await engine?.stop();
}, 30_000);

describe('worker registration with the Rivet Engine', () => {
  it('replaces a registry whose network went silent, and its actors run jobs again', async () => {
    const proxy = await start_network_proxy(engine.connection.endpoint);
    const services = create_services();
    const connection = { ...engine.connection, endpoint: proxy.endpoint };
    const create_registry = () => create_worker_registry(services, connection);
    const first_registry = await register_with_rivet(services, create_registry);
    const watch = start_registration_watch(services, {
      registry: first_registry,
      create_registry,
      timing: fast_timing,
    });
    await wait_until_healthy(first_registry);
    const silenced_at = Date.now();

    proxy.silence_open_sockets();
    await wait_until(() => logged(services.log.info, 'again with a new registry'), 60_000);

    expect(logged(services.log.warn, 'the worker lost its Rivet registration')).toBe(true);
    expect(logged(services.log.error, 'it registers a new registry')).toBe(true);
    expect(Date.now() - silenced_at).toBeGreaterThan(20_000);
    expect(watch.read_registry()).not.toBe(first_registry);
    await wait_until_healthy(watch.read_registry());
    const job_id = await ring_one_job(services);
    await wait_until(() => handled.some((entry) => entry.job_id === job_id), 15_000);
    expect(handled.filter((entry) => entry.job_id === job_id)).toEqual([
      { job_id, locked_by: expect.stringMatching(/^queue_worker:/) },
    ]);

    await watch.stop();
    proxy.close();
  }, 90_000);

  it('warns and waits while the engine link is down for less than the budget', async () => {
    const proxy = await start_network_proxy(engine.connection.endpoint);
    const services = create_services();
    const connection = { ...engine.connection, endpoint: proxy.endpoint };
    const create_registry = () => create_worker_registry(services, connection);
    const registry = await register_with_rivet(services, create_registry);
    const watch = start_registration_watch(services, {
      registry,
      create_registry,
      timing: { check_interval_ms: 1_000, lost_budget_ms: 120_000 },
    });
    await wait_until_healthy(registry);

    proxy.silence_open_sockets();
    await wait_until(() => logged(services.log.warn, 'lost its Rivet registration'), 40_000);

    expect(watch.read_registry()).toBe(registry);
    expect(logged(services.log.error, 'it registers a new registry')).toBe(false);

    await Promise.race([watch.stop(), new Promise((resolve) => setTimeout(resolve, 12_000))]);
    proxy.close();
  }, 60_000);
});

function create_services(): WorkerServices {
  const log = create_logger('worker_registration_test');
  vi.spyOn(log, 'info');
  vi.spyOn(log, 'warn');
  vi.spyOn(log, 'error');
  return {
    db,
    find_event_job_handler: (name) => (name === test_job_handler ? test_handler : null),
    log,
    now: () => new Date(),
    rivet_region: undefined,
    rivet_key_scope: engine.connection.pool,
    rivet_engine: engine.connection,
  };
}

function logged(log_method: unknown, text: string) {
  const calls = (log_method as ReturnType<typeof vi.fn>).mock.calls;
  return calls.some(([message]) => String(message).includes(text));
}

async function ring_one_job(services: WorkerServices) {
  const client = createClient<WorkerRegistry>(engine.connection);
  const ring = create_queue_worker_ring(client, services);
  configure_event_job_doorbell({
    ring: ({ workspace_id, queue_key, job_ids }) =>
      ring({ workspace_id, queue_key, job_id: job_ids[0] ?? '' }),
  });
  const result = await queue_and_run_event_jobs(
    db,
    {
      workspace_id,
      source: 'test:registration',
      source_event_id: randomUUID(),
      event_type: 'message',
      queue_key: `test:registration:${randomUUID()}`,
      actor_key: 'user:test',
      event_jobs: [{ job_handler: test_job_handler }],
    },
    (name) => (name === test_job_handler ? test_handler : null),
  );
  const job_id = result.event_jobs[0]?.job_id;
  if (!job_id) throw new Error('Expected one queued job');
  return job_id;
}

async function start_network_proxy(engine_endpoint: string) {
  const engine_port = Number(new URL(engine_endpoint).port);
  const silent_sockets = new Set<Socket>();
  const open_sockets = new Set<Socket>();
  const server: Server = createServer((client) => {
    const upstream = connect(engine_port, '127.0.0.1');
    for (const socket of [client, upstream]) {
      open_sockets.add(socket);
      socket.on('error', () => {});
    }
    client.on('data', (data) => silent_sockets.has(client) || upstream.write(data));
    upstream.on('data', (data) => silent_sockets.has(upstream) || client.write(data));
    const close_both = () => {
      if (silent_sockets.has(client)) return;
      client.destroy();
      upstream.destroy();
    };
    client.on('close', close_both);
    upstream.on('close', close_both);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    silence_open_sockets: () => {
      for (const socket of open_sockets) silent_sockets.add(socket);
    },
    close: () => {
      for (const socket of open_sockets) socket.destroy();
      server.close();
    },
  };
}

async function wait_until_healthy(registry: WorkerRegistry) {
  const deadline = Date.now() + 10_000;
  while ((await registry.routes.health()).status !== 200) {
    if (Date.now() > deadline) throw new Error('The registry never got an engine ping.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function wait_until(is_true: () => boolean, timeout_ms: number) {
  const deadline = Date.now() + timeout_ms;
  while (!is_true()) {
    if (Date.now() > deadline) throw new Error('The condition did not become true in time.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
