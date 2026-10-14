import type { LocalServer, LocalServerRoute } from '@connectors/__tests__/local_file_server';
import {
  build_dependencies,
  create_localhost_certificate,
  create_recording_sender,
  http_policy_for,
  secret_token,
  start_local_server,
} from '@connectors/__tests__/local_file_server';
import { fetch_connector_file } from '@connectors/runtime/fetch_connector_file';
import { afterEach, describe, expect, it } from 'vitest';

const running_servers: LocalServer[] = [];

async function serve(route: LocalServerRoute) {
  const server = await start_local_server(route);
  running_servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(running_servers.splice(0).map((server) => server.stop()));
});

async function download(server: LocalServer, limits = {}) {
  const sender = create_recording_sender();
  const dependencies = build_dependencies(http_policy_for(server), sender, limits);
  const result = await fetch_connector_file(dependencies, {
    url: `${server.url}/file?sig=abc`,
    headers: { Authorization: secret_token },
  });
  return { result, sent_urls: sender.sent_urls };
}

function text_of(result: { outcome: string; bytes?: Uint8Array }) {
  return result.bytes ? Buffer.from(result.bytes).toString('utf8') : null;
}

describe('fetch_connector_file: an allowed host', () => {
  it('reads the bytes and sends the token once', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('hello from the allowed host');
    });
    const { result } = await download(server);
    expect(result).toEqual({
      outcome: 'ok',
      bytes: new Uint8Array(Buffer.from('hello from the allowed host')),
      content_type: 'text/plain',
    });
    expect(server.hits).toEqual([{ path: '/file?sig=abc', authorization: secret_token }]);
  });

  it('reads from the app base_url host when no wildcard matches it', async () => {
    const certificate = create_localhost_certificate();
    const server = await start_local_server(
      (_request, response) => response.end('base-url-bytes'),
      { certificate },
    );
    running_servers.push(server);
    const policy = {
      allowed_hosts: ['*.files.example.net'],
      base_url_host: `localhost:${server.port}`,
    };
    const sender = create_recording_sender(certificate);
    const result = await fetch_connector_file(build_dependencies(policy, sender), {
      url: `${server.url}/f`,
      headers: { Authorization: secret_token },
    });
    expect(text_of(result)).toBe('base-url-bytes');
    expect(server.hits).toEqual([{ path: '/f', authorization: secret_token }]);
  });

  it('refuses a malformed url without a request', async () => {
    const sender = create_recording_sender();
    const policy = { allowed_hosts: ['localhost'], base_url_host: 'localhost' };
    const result = await fetch_connector_file(build_dependencies(policy, sender), {
      url: 'not a url',
    });
    expect(result).toMatchObject({ outcome: 'download_failed', reason: 'invalid_url' });
    expect(sender.sent_urls).toEqual([]);
  });
});

describe('fetch_connector_file: statuses map through status_error_code', () => {
  it.each([
    [401, {}, 'unauthorized', null],
    [403, {}, 'unauthorized', null],
    [403, { 'retry-after': '5' }, 'rate_limited', 5000],
    [429, { 'retry-after': '7' }, 'rate_limited', 7000],
    [429, {}, 'rate_limited', null],
    [404, {}, 'provider_error', null],
    [500, {}, 'provider_error', null],
    [503, {}, 'provider_error', null],
  ])('%i %j -> %s', async (status, headers, reason, retry_after_ms) => {
    const server = await serve((_request, response) => {
      response.writeHead(status, headers);
      response.end(`nope ${secret_token}`);
    });
    const { result } = await download(server);
    expect(result).toEqual({
      outcome: 'download_failed',
      reason,
      status,
      retry_after_ms,
      detail: `HTTP ${status} from localhost`,
    });
    expect(server.hits.length).toBe(1);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});

describe('fetch_connector_file: the byte cap', () => {
  it('stops at a declared content-length over the cap before reading the body', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { 'content-length': String(10 * 1024 * 1024) });
      response.write(Buffer.alloc(1000));
    });
    const started_ms = performance.now();
    const { result } = await download(server, { timeout_ms: 2000 });
    expect(result).toEqual({ outcome: 'too_large' });
    expect(performance.now() - started_ms).toBeLessThan(1500);
    expect(server.hits.length).toBe(1);
  });

  it('stops a chunked body that grows past the cap', async () => {
    const chunks_written = { value: 0 };
    const server = await serve((_request, response) => {
      response.writeHead(200);
      const write_next_chunk = () => {
        if (chunks_written.value >= 40 || response.destroyed) return response.end();
        chunks_written.value += 1;
        response.write(Buffer.alloc(128 * 1024), () => setTimeout(write_next_chunk, 5));
      };
      write_next_chunk();
    });
    const { result } = await download(server);
    expect(result).toEqual({ outcome: 'too_large' });
    expect(chunks_written.value).toBeLessThan(40);
    expect(server.hits.length).toBe(1);
  });

  it('keeps a body that understates its length within the cap', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { 'content-length': '10' });
      response.end(Buffer.alloc(3 * 1024 * 1024));
    });
    const { result } = await download(server);
    expect(result.outcome === 'ok' ? result.bytes.byteLength : 0).toBeLessThanOrEqual(1024 * 1024);
    expect(server.hits.length).toBe(1);
  });

  it.each([
    ['a chunked body under the cap', ['chunk-a,', 'chunk-b'], 'chunk-a,chunk-b'],
    ['a body of exactly the cap', [Buffer.alloc(1024 * 1024, 97)], 'a'.repeat(1024 * 1024)],
  ])('reads %s', async (_label, parts, expected) => {
    const server = await serve((_request, response) => {
      response.writeHead(200);
      for (const part of parts) response.write(part);
      response.end();
    });
    const { result } = await download(server);
    expect(text_of(result)).toBe(expected);
    expect(server.hits.length).toBe(1);
  });

  it('reads 20 MB under a 25 MB cap', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200);
      for (const _chunk of Array.from({ length: 20 }))
        response.write(Buffer.alloc(1024 * 1024, 97));
      response.end();
    });
    const { result } = await download(server, { max_bytes: 25 * 1024 * 1024 });
    expect(result.outcome === 'ok' ? result.bytes.byteLength : 0).toBe(20 * 1024 * 1024);
    expect(server.hits.length).toBe(1);
  }, 20000);
});
