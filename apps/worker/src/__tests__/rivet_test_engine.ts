import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RivetConnection } from '@coworker/config';

export type TestEngine = {
  connection: RivetConnection & { token: string };
  stop: () => Promise<void>;
};

export const test_engine_admin_token = 'test-rivet-admin-token';

export async function start_rivet_test_engine(port?: number): Promise<TestEngine> {
  const guard_port = port ?? (await find_free_engine_port());
  const storage = mkdtempSync(join(tmpdir(), 'rivet-test-engine-'));
  const engine = spawn(read_engine_binary_path(), ['start'], {
    env: {
      ...process.env,
      RIVET__GUARD__PORT: String(guard_port),
      RIVET__API_PEER__PORT: String(guard_port + 1),
      RIVET__METRICS__PORT: String(guard_port + 10),
      RIVET__FILE_SYSTEM__PATH: join(storage, 'db'),
      RIVET__AUTH__ADMIN_TOKEN: test_engine_admin_token,
      RIVET__RUNTIME__WORKER_CPU_MAX: '1000000',
    },
    stdio: 'ignore',
  });
  const connection = {
    endpoint: `http://127.0.0.1:${guard_port}`,
    token: test_engine_admin_token,
    pool: 'default',
  };
  await upsert_normal_runner_config(connection, connection.pool);
  return {
    connection,
    stop: async () => {
      await stop_process(engine);
      rmSync(storage, { recursive: true, force: true });
    },
  };
}

export async function upsert_normal_runner_config(
  connection: { endpoint: string; token: string },
  pool: string,
) {
  const headers = {
    authorization: `Bearer ${connection.token}`,
    'content-type': 'application/json',
  };
  const url = `${connection.endpoint}/runner-configs/${pool}?namespace=default`;
  const body = JSON.stringify({ datacenters: { default: { normal: {} } } });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(url, { method: 'PUT', headers, body }).catch((error: unknown) => {
      console.warn('the engine is not up yet', error);
      return null;
    });
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The test Rivet Engine at ${connection.endpoint} did not start.`);
}

function read_engine_binary_path() {
  const rivetkit_require = createRequire(fileURLToPath(import.meta.resolve('rivetkit')));
  const engine_cli = rivetkit_require('@rivetkit/engine-cli') as { getEnginePath(): string };
  return engine_cli.getEnginePath();
}

export async function find_free_engine_port() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const port = await take_free_port();
    const free = await Promise.all([port + 1, port + 10].map(port_is_free));
    if (port + 10 < 65_536 && free.every(Boolean)) return port;
  }
  throw new Error('No free port triple for the test Rivet Engine.');
}

function take_free_port() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function port_is_free(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function stop_process(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  await exited;
  clearTimeout(timer);
}
