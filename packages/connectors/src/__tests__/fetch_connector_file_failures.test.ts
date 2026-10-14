import type { LocalServer, LocalServerRoute } from '@connectors/__tests__/local_file_server';
import {
  build_dependencies,
  create_localhost_certificate,
  create_recording_sender,
  http_policy_for,
  secret_token,
  start_local_server,
} from '@connectors/__tests__/local_file_server';
import type { FileRequestSender } from '@connectors/runtime/fetch_connector_file';
import { fetch_connector_file } from '@connectors/runtime/fetch_connector_file';
import { afterEach, describe, expect, it } from 'vitest';

const running_servers: LocalServer[] = [];

async function serve(route: LocalServerRoute, options = {}) {
  const server = await start_local_server(route, options);
  running_servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(running_servers.splice(0).map((server) => server.stop()));
});

const never_answer: LocalServerRoute = () => {};

const stall_after_first_bytes: LocalServerRoute = (_request, response) => {
  response.writeHead(200);
  response.write('first-bytes');
};

async function download(
  server: LocalServer,
  options: { timeout_ms?: number; signal?: AbortSignal },
) {
  const sender = create_recording_sender();
  const limits = { timeout_ms: options.timeout_ms ?? 5000 };
  const dependencies = build_dependencies(http_policy_for(server), sender, limits);
  const signal = options.signal ? { signal: options.signal } : {};
  return fetch_connector_file(dependencies, {
    url: `${server.url}/f?token=SECRET-QUERY`,
    headers: { Authorization: secret_token },
    ...signal,
  });
}

describe('fetch_connector_file: I/O errors never throw', () => {
  it('turns a socket closed mid-body into network_error', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { 'content-length': '100000' });
      response.write(Buffer.alloc(1000));
      setTimeout(() => response.socket?.destroy(), 30);
    });
    expect(await download(server, {})).toEqual({
      outcome: 'download_failed',
      reason: 'network_error',
      status: null,
      retry_after_ms: null,
      detail: 'ECONNRESET from localhost',
    });
    expect(server.hits.length).toBe(1);
  });

  it('turns a refused connection into network_error without the url query', async () => {
    const server = await serve(never_answer);
    await server.stop();
    const result = await download(server, {});
    expect(result).toMatchObject({ outcome: 'download_failed', reason: 'network_error' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(server.hits.length).toBe(0);
  });

  it('turns an untrusted certificate into network_error', async () => {
    const certificate = create_localhost_certificate();
    const server = await serve((_request, response) => response.end('x'), { certificate });
    const policy = { allowed_hosts: [`localhost:${server.port}`], base_url_host: 'x.invalid' };
    const result = await fetch_connector_file(
      build_dependencies(policy, create_recording_sender()),
      {
        url: server.url,
      },
    );
    expect(result).toMatchObject({
      reason: 'network_error',
      detail: 'DEPTH_ZERO_SELF_SIGNED_CERT from localhost',
    });
    expect(server.hits.length).toBe(0);
  });

  it('turns a DNS failure into network_error with its code only', async () => {
    const dns_error = Object.assign(new TypeError('getaddrinfo ENOTFOUND files.slack.com SECRET'), {
      code: 'ENOTFOUND',
    });
    const send_request: FileRequestSender = () => Promise.reject(dns_error);
    const policy = { allowed_hosts: ['files.slack.com'], base_url_host: 'slack.com' };
    const limits = { max_bytes: 1024, max_redirects: 3, timeout_ms: 1000 };
    const result = await fetch_connector_file(
      { policy, limits, send_request },
      { url: 'https://files.slack.com/f?token=SECRET' },
    );
    expect(result).toEqual({
      outcome: 'download_failed',
      reason: 'network_error',
      status: null,
      retry_after_ms: null,
      detail: 'ENOTFOUND from files.slack.com',
    });
  });
});

describe('fetch_connector_file: timeout and caller signal', () => {
  it('times out a server that never sends headers', async () => {
    const server = await serve(never_answer);
    expect(await download(server, { timeout_ms: 300 })).toEqual({ outcome: 'timed_out' });
    expect(server.hits.length).toBe(1);
  });

  it('times out a body that stalls', async () => {
    const server = await serve(stall_after_first_bytes);
    expect(await download(server, { timeout_ms: 300 })).toEqual({ outcome: 'timed_out' });
    expect(server.hits.length).toBe(1);
  });

  it.each([
    ['before headers', never_answer],
    ['mid-body', stall_after_first_bytes],
  ])(
    'stops at once when the caller aborts %s',
    async (_label, route) => {
      const server = await serve(route);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      const started_ms = performance.now();
      const result = await download(server, { timeout_ms: 8000, signal: controller.signal });
      expect(result).toEqual({ outcome: 'aborted' });
      expect(performance.now() - started_ms).toBeLessThan(2000);
      expect(server.hits.length).toBe(1);
    },
    12000,
  );

  it('makes no request when the caller signal is already aborted', async () => {
    const server = await serve((_request, response) => response.end('x'));
    expect(await download(server, { signal: AbortSignal.abort() })).toEqual({ outcome: 'aborted' });
    expect(server.hits.length).toBe(0);
  });
});
