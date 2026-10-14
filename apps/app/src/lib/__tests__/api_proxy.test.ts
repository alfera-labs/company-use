import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxy_to_api } from '@/lib/api_proxy';

const mocks = vi.hoisted(() => ({ read_workos_auth: vi.fn(), fetch_through_tunnel: vi.fn() }));

vi.mock('@/lib/workos_session', () => ({ read_workos_auth: mocks.read_workos_auth }));

vi.mock('@/lib/api/upstream_tunnel', async (import_original) => {
  const original = await import_original<typeof import('@/lib/api/upstream_tunnel')>();
  mocks.fetch_through_tunnel.mockImplementation(original.fetch_through_tunnel);
  return { ...original, fetch_through_tunnel: mocks.fetch_through_tunnel };
});

const original_env = {
  API_URL: process.env.API_URL,
  COWORKER_API_PROXY_SECRET: process.env.COWORKER_API_PROXY_SECRET,
};

const ada = {
  id: 'user_123',
  email: 'founder@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  profilePictureUrl: null,
};

function sign_in(user: typeof ada | null, organization_id?: string) {
  mocks.read_workos_auth.mockResolvedValue({
    user,
    ...(organization_id ? { organizationId: organization_id } : {}),
  });
}

function stub_fetch(respond: () => Response) {
  const fetch_mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => respond());
  vi.stubGlobal('fetch', fetch_mock);
  return fetch_mock;
}

function sent_headers(fetch_mock: ReturnType<typeof stub_fetch>) {
  const headers = fetch_mock.mock.calls[0]?.[1]?.headers;
  if (!(headers instanceof Headers)) throw new Error('the proxy did not send a Headers object');
  return headers;
}

describe('app API proxy', () => {
  beforeEach(() => {
    process.env.API_URL = 'http://api.test';
    process.env.COWORKER_API_PROXY_SECRET = 'test-proxy-secret';
  });

  afterEach(() => {
    restore_env('API_URL', original_env.API_URL);
    restore_env('COWORKER_API_PROXY_SECRET', original_env.COWORKER_API_PROXY_SECRET);
    mocks.read_workos_auth.mockReset();
    mocks.fetch_through_tunnel.mockClear();
    vi.unstubAllGlobals();
  });

  it('refuses the sign-up routes, which only the dashboard server may call', async () => {
    sign_in(ada);
    const fetch_mock = stub_fetch(() => new Response());

    const response = await proxy_to_api(
      new Request('http://app.localhost:4307/api/v1/auth/workspace/personal', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({
          workspace_data: { inbound_email: { retired_usernames: ['other'] } },
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(fetch_mock).not.toHaveBeenCalled();
    expect(mocks.fetch_through_tunnel).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      error: { code: 'forbidden', message: 'This route is not reachable from the browser' },
    });
  });

  it('rejects anonymous API proxy requests', async () => {
    sign_in(null);
    const fetch_mock = stub_fetch(() => new Response());

    const response = await proxy_to_api(new Request('http://app.localhost:4307/api/v1/workspace'));

    expect(response.status).toBe(401);
    expect(mocks.read_workos_auth).toHaveBeenCalledOnce();
    expect(fetch_mock).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Sign in to use the API' },
    });
  });

  it('forwards WorkOS identity headers when a user is signed in', async () => {
    sign_in(ada, 'org_123');
    const fetch_mock = stub_fetch(() => Response.json({ data: { workspace_id: 'ws_signed_in' } }));

    const response = await proxy_to_api(new Request('http://app.localhost:4307/api/v1/workspace'));

    expect(response.status).toBe(200);
    const headers = sent_headers(fetch_mock);
    expect(headers.get('x-coworker-api-secret')).toBe('test-proxy-secret');
    expect(headers.get('x-coworker-auth-provider')).toBe('workos');
    expect(headers.get('x-coworker-auth-user-id')).toBe('user_123');
    expect(headers.get('x-coworker-auth-organization-id')).toBe('org_123');
  });

  it('forwards Last-Event-ID so an SSE reconnect resumes after the last received event', async () => {
    sign_in(ada, 'org_123');
    const fetch_mock = stub_fetch(
      () =>
        new Response('event: stream_end\ndata: {"reason":"end_event"}\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    );

    const response = await proxy_to_api(
      new Request('http://app.localhost:4307/api/v1/runs/run_123/events', {
        headers: { Accept: 'text/event-stream', 'Last-Event-ID': '42' },
      }),
    );

    expect(response.status).toBe(200);
    expect(fetch_mock.mock.calls[0]?.[0]).toBe('http://api.test/v1/runs/run_123/events');
    const headers = sent_headers(fetch_mock);
    expect(headers.get('accept')).toBe('text/event-stream');
    expect(headers.get('last-event-id')).toBe('42');
  });

  it('forwards Range so a video or audio original can seek, and keeps the partial answer', async () => {
    sign_in(ada, 'org_123');
    const fetch_mock = stub_fetch(
      () =>
        new Response('%PDF', {
          status: 206,
          headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-3/94525' },
        }),
    );

    const response = await proxy_to_api(
      new Request('http://app.localhost:4307/api/v1/brain/documents/bitem_1/original', {
        headers: { Range: 'bytes=0-3' },
      }),
    );

    expect(sent_headers(fetch_mock).get('range')).toBe('bytes=0-3');
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-3/94525');
  });

  it('forwards If-Match, the file version a document save is checked against', async () => {
    sign_in(ada, 'org_123');
    const fetch_mock = stub_fetch(() => Response.json({ data: { saved: true } }));

    await proxy_to_api(
      new Request('http://app.localhost:4307/api/v1/workspace/files/bytes?file_path=a.docx', {
        method: 'PUT',
        headers: { 'If-Match': 'ab'.repeat(32), 'sec-fetch-site': 'same-origin' },
        body: 'docx bytes',
      }),
    );

    expect(sent_headers(fetch_mock).get('if-match')).toBe('ab'.repeat(32));
  });

  it('forwards SSE chunks without buffering and cancels the upstream stream on disconnect', async () => {
    sign_in(ada, 'org_123');
    const upstream_cancelled = vi.fn();
    let upstream_controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const upstream_body = new ReadableStream<Uint8Array>({
      start(controller) {
        upstream_controller = controller;
      },
      cancel: upstream_cancelled,
    });
    const fetch_mock = stub_fetch(
      () => new Response(upstream_body, { headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const request_abort = new AbortController();
    const request = new Request('http://app.localhost:4307/api/v1/runs/run_123/events', {
      headers: { Accept: 'text/event-stream' },
      signal: request_abort.signal,
    });

    const response = await proxy_to_api(request);
    if (!response.body || !upstream_controller) throw new Error('SSE proxy stream did not open.');
    const reader = response.body.getReader();
    const first_read = reader.read();
    const first_frame = 'id: 1\nevent: run_event\ndata: {"event_sequence":1}\n\n';
    upstream_controller.enqueue(new TextEncoder().encode(first_frame));

    const first_chunk = await first_read;
    expect(first_chunk.done).toBe(false);
    expect(new TextDecoder().decode(first_chunk.value)).toBe(first_frame);
    const upstream_init = fetch_mock.mock.calls[0]?.[1];
    expect(upstream_init?.signal).toBe(request.signal);

    await reader.cancel('browser disconnected');
    request_abort.abort();
    expect(upstream_cancelled).toHaveBeenCalledWith('browser disconnected');
    expect(upstream_init?.signal?.aborted).toBe(true);
  });

  it('forwards only known-safe browser headers to the upstream API', async () => {
    sign_in(ada, 'org_123');
    const fetch_mock = stub_fetch(() => Response.json({ data: { workspace_id: 'ws_signed_in' } }));

    const response = await proxy_to_api(
      new Request('http://app.localhost:4307/api/v1/workspace', {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer browser-token',
          cookie: `wos-session=${'x'.repeat(16_000)}; alfera_authed=1`,
          'content-type': 'application/json',
          origin: 'https://app.alfera.ai',
          'user-agent': 'Chrome 149.0.0.0',
          'x-coworker-api-secret': 'browser-spoof',
          'x-random-browser-header': 'leak',
        },
      }),
    );

    expect(response.status).toBe(200);
    const headers = sent_headers(fetch_mock);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('origin')).toBe('https://app.alfera.ai');
    expect(headers.get('user-agent')).toBe('Chrome 149.0.0.0');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-random-browser-header')).toBeNull();
    expect(headers.get('x-coworker-api-secret')).toBe('test-proxy-secret');
  });

  it('forwards the visitor IP, never a browser-sent IP', async () => {
    sign_in(ada, 'org_123');
    const fetch_mock = stub_fetch(() => Response.json({ data: {} }));

    await proxy_to_api(
      new Request('http://app.localhost:4307/api/v1/workspace', {
        headers: {
          cookie: '_ga=GA1',
          'x-forwarded-for': '203.0.113.9, 10.0.0.1',
          'x-coworker-client-ip': '6.6.6.6',
        },
      }),
    );

    const headers = sent_headers(fetch_mock);
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-coworker-client-ip')).toBe('203.0.113.9');
  });

  it('forwards the connection address when the dashboard port is open with no proxy', async () => {
    vi.stubEnv('APP_BIND', '0.0.0.0');
    sign_in(ada, 'org_123');
    const fetch_mock = stub_fetch(() => Response.json({ data: {} }));
    const request = new Request('http://app.localhost:4307/api/v1/workspace', {
      headers: { 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.10' },
    });
    Object.defineProperty(request, 'ip', { value: '198.51.100.20' });

    await proxy_to_api(request);

    vi.unstubAllEnvs();
    expect(sent_headers(fetch_mock).get('x-coworker-client-ip')).toBe('198.51.100.20');
  });

  it('sends ngrok-skip-browser-warning so an ngrok API tunnel returns JSON, not its interstitial', async () => {
    process.env.API_URL = 'https://abc123.ngrok-free.app';
    sign_in(ada, 'org_123');
    const fetch_mock = stub_fetch(() => Response.json({ data: { workspace_id: 'ws_signed_in' } }));

    const response = await proxy_to_api(
      new Request('http://app.localhost:4307/api/v1/workspace', {
        headers: { accept: 'text/html,application/json' },
      }),
    );

    expect(response.status).toBe(200);
    expect(fetch_mock.mock.calls[0]?.[0]).toBe('https://abc123.ngrok-free.app/v1/workspace');
    expect(sent_headers(fetch_mock).get('ngrok-skip-browser-warning')).toBe('true');
  });

  it('refuses a write from a sandbox preview page, which is the same site but not the same origin', async () => {
    sign_in(ada, 'org_123');
    const fetch_mock = stub_fetch(() => Response.json({ data: {} }));
    const request = new Request('https://app.alfera.ai/api/v1/workspace/email-address', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        origin: 'https://evil-5173-a1b2.sandboxes.alfera.ai',
        'sec-fetch-site': 'same-site',
      },
      body: '{"username":"attacker-picked"}',
    });

    const response = await proxy_to_api(request);

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('forbidden');
    expect(fetch_mock).not.toHaveBeenCalled();
  });

  it('streams a POST body upstream and forbids replaying it on a retry', async () => {
    sign_in(ada, 'org_123');
    const fetch_mock = stub_fetch(() => Response.json({ data: { id: 'task_1' } }));
    const request = new Request('http://app.localhost:4307/api/v1/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: '{"title":"Draft the invoice"}',
    });

    const response = await proxy_to_api(request);

    expect(response.status).toBe(200);
    expect(mocks.fetch_through_tunnel).toHaveBeenCalledWith(
      'http://api.test/v1/tasks',
      expect.objectContaining({ method: 'POST', duplex: 'half', body: request.body }),
      { can_retry: false },
    );
    expect(fetch_mock.mock.calls[0]?.[1]?.body).toBe(request.body);
  });

  it('propagates an upstream connection failure instead of answering for the API', async () => {
    sign_in(ada, 'org_123');
    stub_fetch(() => {
      throw new Error('upstream refused the connection');
    });

    await expect(
      proxy_to_api(new Request('http://app.localhost:4307/api/v1/workspace')),
    ).rejects.toThrow('upstream refused the connection');
  });

  it('keeps every upstream Set-Cookie on the proxied response', async () => {
    sign_in(ada, 'org_123');
    const upstream_headers = new Headers({ 'Content-Type': 'application/json' });
    upstream_headers.append('set-cookie', 'wos-session=refreshed; Path=/; HttpOnly');
    upstream_headers.append('set-cookie', 'alfera_authed=1; Path=/');
    stub_fetch(() => new Response('{}', { headers: upstream_headers }));

    const response = await proxy_to_api(new Request('http://app.localhost:4307/api/v1/workspace'));

    expect(response.headers.getSetCookie()).toEqual([
      'wos-session=refreshed; Path=/; HttpOnly',
      'alfera_authed=1; Path=/',
    ]);
  });
});

function restore_env(name: keyof typeof original_env, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
