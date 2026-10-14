import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let current_request = new Request('http://app.localhost:4307/api/v1/workspace');
vi.mock('@tanstack/react-start/server', () => ({ getRequest: () => current_request }));

const { proxy_to_api } = await import('@/lib/api_proxy');
const { prime_request_auth } = await import('@/lib/workos_session');

const original_env = {
  API_URL: process.env.API_URL,
  COWORKER_API_PROXY_SECRET: process.env.COWORKER_API_PROXY_SECRET,
};

const ada = {
  object: 'user' as const,
  id: 'user_123',
  email: 'founder@example.com',
  emailVerified: true,
  name: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  profilePictureUrl: null,
  lastSignInAt: null,
  locale: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  externalId: null,
  metadata: {},
};

function signed_in_request(cookie: string) {
  current_request = new Request('http://app.localhost:4307/api/v1/workspace', {
    headers: { cookie },
  });
  prime_request_auth(current_request, { auth: { user: ada, organizationId: 'org_123' } });
  return current_request;
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

describe('app API proxy and the cookies of the browser', () => {
  beforeEach(() => {
    process.env.API_URL = 'http://api.test';
    process.env.COWORKER_API_PROXY_SECRET = 'test-proxy-secret';
  });

  afterEach(() => {
    restore_env('API_URL', original_env.API_URL);
    restore_env('COWORKER_API_PROXY_SECRET', original_env.COWORKER_API_PROXY_SECRET);
    vi.unstubAllGlobals();
  });

  it('forwards no session cookie and no attribution cookie', async () => {
    const fetch_mock = stub_fetch(() => Response.json({ data: { workspace_id: 'ws_signed_in' } }));

    await proxy_to_api(
      signed_in_request(
        `wos-session=${'x'.repeat(16_000)}; alfera_attribution=%7B%22gclid%22%3A%22G-1%22%7D; alfera_referral=partner_1; alfera_authed=1`,
      ),
    );

    expect(sent_headers(fetch_mock).get('cookie')).toBeNull();
  });

  it('forwards no advertising cookie and no consent answer', async () => {
    const fetch_mock = stub_fetch(() => Response.json({ data: {} }));

    await proxy_to_api(
      signed_in_request('_fbp=fb.1.1.2; _fbc=fb.1.1.FBCLID; alfera_consent=granted; _ga=GA1'),
    );

    expect(sent_headers(fetch_mock).get('cookie')).toBeNull();
  });
});

function restore_env(name: keyof typeof original_env, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
