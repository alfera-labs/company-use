import type {
  LocalCertificate,
  LocalServer,
  LocalServerRoute,
} from '@connectors/__tests__/local_file_server';
import {
  build_dependencies,
  create_localhost_certificate,
  create_recording_sender,
  http_policy_for,
  secret_token,
  start_local_server,
} from '@connectors/__tests__/local_file_server';
import { fetch_connector_file } from '@connectors/runtime/fetch_connector_file';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const running_servers: LocalServer[] = [];
let certificate: LocalCertificate;

beforeAll(() => {
  certificate = create_localhost_certificate();
});

async function serve(route: LocalServerRoute, options = {}) {
  const server = await start_local_server(route, options);
  running_servers.push(server);
  return server;
}

function redirect_to(location: string, status = 302): LocalServerRoute {
  return (_request, response) => {
    response.writeHead(status, { location });
    response.end();
  };
}

afterEach(async () => {
  await Promise.all(running_servers.splice(0).map((server) => server.stop()));
});

async function download_from(source: LocalServer, ...allowed: LocalServer[]) {
  const sender = create_recording_sender();
  const dependencies = build_dependencies(http_policy_for(source, ...allowed), sender);
  return fetch_connector_file(dependencies, {
    url: source.url,
    headers: { Authorization: secret_token },
  });
}

describe('fetch_connector_file: redirects', () => {
  it.each([301, 302, 303, 307, 308])('refuses a %i to a foreign host', async (status) => {
    const foreign = await serve((_request, response) => response.end('stolen'), {
      hostname: '127.0.0.1',
    });
    const source = await serve(redirect_to(`${foreign.url}/x`, status));
    expect(await download_from(source)).toEqual({ outcome: 'host_refused' });
    expect(source.hits.length).toBe(1);
    expect(foreign.hits.length).toBe(0);
  });

  it('follows a same-host redirect and re-sends the token on the allowed hop', async () => {
    const source = await serve((request, response) => {
      if (request.url === '/final') return response.end('final-bytes');
      redirect_to('/final')(request, response);
    });
    const result = await download_from(source);
    expect(result.outcome === 'ok' ? Buffer.from(result.bytes).toString() : null).toBe(
      'final-bytes',
    );
    expect(source.hits).toEqual([
      { path: '/', authorization: secret_token },
      { path: '/final', authorization: secret_token },
    ]);
  });

  it('refuses a redirect to another port of the allowed host', async () => {
    const other_port = await serve((_request, response) => response.end('other-port'));
    const source = await serve(redirect_to(other_port.url));
    expect(await download_from(source)).toEqual({ outcome: 'host_refused' });
    expect(other_port.hits.length).toBe(0);
  });

  it('follows a redirect to another port the policy names', async () => {
    const other_port = await serve((_request, response) => response.end('named-port'));
    const source = await serve(redirect_to(other_port.url));
    const result = await download_from(source, other_port);
    expect(result.outcome === 'ok' ? Buffer.from(result.bytes).toString() : null).toBe(
      'named-port',
    );
    expect(other_port.hits.length).toBe(1);
  });

  it('refuses an https to http downgrade on an allowed host', async () => {
    const plain = await serve((_request, response) => response.end('plaintext-bytes'));
    const secure = await serve(redirect_to(plain.url), { certificate });
    const policy = {
      allowed_hosts: [`localhost:${secure.port}`, `http://localhost:${plain.port}`],
      base_url_host: 'api.example.invalid',
    };
    const sender = create_recording_sender(certificate);
    const result = await fetch_connector_file(build_dependencies(policy, sender), {
      url: secure.url,
      headers: { Authorization: secret_token },
    });
    expect(result).toEqual({ outcome: 'host_refused' });
    expect(secure.hits.length).toBe(1);
    expect(plain.hits.length).toBe(0);
  });

  it('stops a redirect loop at max_redirects', async () => {
    const source = await serve(redirect_to('/again'));
    expect(await download_from(source)).toMatchObject({
      outcome: 'download_failed',
      reason: 'too_many_redirects',
    });
    expect(source.hits.length).toBe(4);
  });

  it('follows nothing when max_redirects is 0', async () => {
    const source = await serve(redirect_to('/again'));
    const sender = create_recording_sender();
    const dependencies = build_dependencies(http_policy_for(source), sender, { max_redirects: 0 });
    expect(await fetch_connector_file(dependencies, { url: source.url })).toMatchObject({
      reason: 'too_many_redirects',
    });
    expect(source.hits.length).toBe(1);
  });

  it.each([
    'file:///etc/passwd',
    'data:text/plain,x',
    'ftp://localhost/f',
  ])('refuses a redirect to %s', async (location) => {
    const source = await serve(redirect_to(location));
    expect(await download_from(source)).toEqual({ outcome: 'host_refused' });
    expect(source.hits.length).toBe(1);
  });

  it('fails a redirect with no location', async () => {
    const source = await serve((_request, response) => {
      response.writeHead(302);
      response.end();
    });
    expect(await download_from(source)).toEqual({
      outcome: 'download_failed',
      reason: 'missing_redirect_location',
      status: null,
      retry_after_ms: null,
      detail: 'HTTP 302 from localhost without a usable location',
    });
    expect(source.hits.length).toBe(1);
  });
});
