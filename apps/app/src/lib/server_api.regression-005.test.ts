import { afterEach, describe, expect, it, vi } from 'vitest';

const read_workos_auth = vi.hoisted(() => vi.fn());

vi.mock('@/lib/workos_session', () => ({
  read_workos_auth,
}));

const original_env = {
  API_URL: process.env.API_URL,
  COWORKER_API_PROXY_SECRET: process.env.COWORKER_API_PROXY_SECRET,
};

describe('server API client', () => {
  afterEach(() => {
    restore_env('API_URL', original_env.API_URL);
    restore_env('COWORKER_API_PROXY_SECRET', original_env.COWORKER_API_PROXY_SECRET);
    read_workos_auth.mockReset();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('calls the API with a proxy secret and no identity when WorkOS auth is absent', async () => {
    process.env.API_URL = 'http://api.test';
    process.env.COWORKER_API_PROXY_SECRET = 'test-proxy-secret';
    read_workos_auth.mockResolvedValue({ user: null, organizationId: null });
    const fetch_mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ error: { code: 'unauthorized' } }, { status: 401 }),
    );
    vi.stubGlobal('fetch', fetch_mock);

    const { server_api_fetch } = await import('@/lib/server_api');
    const response = await server_api_fetch('/v1/onboarding');

    expect(response.status).toBe(401);
    expect(fetch_mock).toHaveBeenCalledWith(
      'http://api.test/v1/onboarding',
      expect.objectContaining({ cache: 'no-store' }),
    );
    const request_headers = fetch_mock.mock.calls[0]?.[1]?.headers;
    expect(request_headers).toBeInstanceOf(Headers);
    expect((request_headers as Headers).get('x-coworker-api-secret')).toBe('test-proxy-secret');
    expect((request_headers as Headers).get('x-coworker-auth-user-id')).toBeNull();
  });

  it('signs server API requests when WorkOS auth is present', async () => {
    process.env.API_URL = 'http://api.test';
    process.env.COWORKER_API_PROXY_SECRET = 'test-proxy-secret';
    read_workos_auth.mockResolvedValue({
      organizationId: 'org_123',
      user: {
        id: 'user_123',
        email: 'founder@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        profilePictureUrl: 'https://example.com/avatar.png',
      },
    });
    const fetch_mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ data: { completed: true } }, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch_mock);

    const { server_api_fetch } = await import('@/lib/server_api');
    await server_api_fetch('/v1/onboarding');

    const request_headers = fetch_mock.mock.calls[0]?.[1]?.headers;
    expect(request_headers).toBeInstanceOf(Headers);
    expect((request_headers as Headers).get('x-coworker-api-secret')).toBe('test-proxy-secret');
    expect((request_headers as Headers).get('x-coworker-auth-provider')).toBe('workos');
    expect((request_headers as Headers).get('x-coworker-auth-user-id')).toBe('user_123');
    expect((request_headers as Headers).get('x-coworker-auth-organization-id')).toBe('org_123');
  });
});

function restore_env(name: keyof typeof original_env, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
