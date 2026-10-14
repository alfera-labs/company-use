import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/workos_session', async (import_original) => ({
  ...(await import_original<typeof import('@/lib/workos_session')>()),
  build_sign_out_redirect: async (return_to: string) =>
    `https://api.workos.com/logout/${return_to}`,
}));

const { sign_out_method_not_allowed, sign_out_response } = await import('@/routes/auth/sign-out');

describe('/auth/sign-out', () => {
  it('refuses a GET', () => {
    const response = sign_out_method_not_allowed();

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('refuses a POST that did not come from one of our pages, and says so', async () => {
    const response = await sign_out_response(sign_out_request('cross-site'));

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    await expect(response.text()).resolves.toBe('Sign out only works from this site.');
  });

  it('refuses a POST from a sibling subdomain', async () => {
    const response = await sign_out_response(sign_out_request('same-site'));

    expect(response.status).toBe(403);
  });

  it('sends our own page through the WorkOS logout URL and expires the session cookie', async () => {
    const response = await sign_out_response(sign_out_request('same-origin'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('https://api.workos.com/logout/');
    expect(response.headers.getSetCookie().join()).toContain('wos-session=;');
  });
});

describe('/auth/sign-out without Sec-Fetch-Site', () => {
  it('refuses a request that carries no Origin either', async () => {
    const response = await sign_out_response(sign_out_request_with_origin());

    expect(response.status).toBe(403);
  });

  it('refuses an Origin that is not our host', async () => {
    const response = await sign_out_response(sign_out_request_with_origin('https://evil.example'));

    expect(response.status).toBe(403);
  });

  it('accepts an Origin that matches our host', async () => {
    const response = await sign_out_response(sign_out_request_with_origin('https://app.example'));

    expect(response.status).toBe(303);
  });
});

function sign_out_request(site: string) {
  return new Request('https://app.example/auth/sign-out?returnTo=%2F', {
    method: 'POST',
    headers: { host: 'app.example', 'sec-fetch-site': site },
  });
}

function sign_out_request_with_origin(origin?: string) {
  return new Request('https://app.example/auth/sign-out?returnTo=%2F', {
    method: 'POST',
    headers: { host: 'app.example', ...(origin ? { origin } : {}) },
  });
}
