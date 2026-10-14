import { sandbox_preview_base_domain } from '@coworker/config/hosted_defaults';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionAuthentication } from '@/lib/workos_session';

const mocks = vi.hoisted(() => ({
  authenticate_session_cookie: vi.fn(),
  prime_request_auth: vi.fn(),
  proxy_sandbox_preview: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@sentry/tanstackstart-react', () => ({ captureException: mocks.captureException }));

vi.mock('@/lib/workos_session', async (import_original) => ({
  ...(await import_original<typeof import('@/lib/workos_session')>()),
  authenticate_session_cookie: mocks.authenticate_session_cookie,
  prime_request_auth: mocks.prime_request_auth,
}));

vi.mock('@/lib/sandbox_preview_upstream', () => ({
  proxy_sandbox_preview: mocks.proxy_sandbox_preview,
}));

const { app_request_middleware } = await import('@/lib/request_middleware');

describe('request middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signed_out();
    mocks.proxy_sandbox_preview.mockImplementation(async () => new Response('preview'));
  });

  afterEach(() => {
    delete process.env.AUTH_HINT_COOKIE_DOMAIN;
  });

  it('redirects unauthenticated document navigation to sign in', async () => {
    const { response } = await run_middleware(
      new Request('http://app.localhost:3000/home', {
        headers: {
          accept: 'text/html',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
        },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://app.localhost:3000/sign-in?returnTo=%2Fhome',
    );
  });

  it('preserves Business annual selection through sign in', async () => {
    const { response } = await run_middleware(
      new Request('http://app.localhost:3000/usage?plan=business&billing_period=yearly'),
    );
    const sign_in = new URL(response.headers.get('location') ?? '');
    expect(sign_in.pathname).toBe('/sign-in');
    expect(sign_in.searchParams.get('returnTo')).toBe('/usage?plan=business&billing_period=yearly');
  });

  it('returns 401 for unauthenticated in-app data fetches', async () => {
    const { response, next } = await run_middleware(
      new Request('http://app.localhost:3000/settings', {
        headers: {
          accept: 'text/x-component',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-coworker-auth-required')).toBe('1');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for unauthenticated router prefetches', async () => {
    const { response } = await run_middleware(
      new Request('http://app.localhost:3000/integrations', {
        headers: {
          accept: 'text/html',
          purpose: 'prefetch',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'no-cors',
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-coworker-auth-required')).toBe('1');
  });

  it('returns 401 for non-navigation mutations', async () => {
    const { response } = await run_middleware(
      new Request('http://app.localhost:3000/settings', {
        method: 'POST',
        headers: {
          accept: 'text/html',
          'content-type': 'text/plain',
        },
        body: 'change',
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-coworker-auth-required')).toBe('1');
  });

  it('keeps the CTA hint on the parent domain and expires parent-domain session cookies', async () => {
    process.env.AUTH_HINT_COOKIE_DOMAIN = '.example.com';

    const { response } = await run_middleware(
      new Request('https://app-dev.example.com/home', {
        headers: {
          accept: 'text/html',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
        },
      }),
    );
    const set_cookies = response.headers.getSetCookie();

    const hint = find_set_cookie(set_cookies, 'alfera_authed');
    expect(hint).toContain('Domain=.example.com');
    expect(hint).toContain('alfera_authed=;');
    expect(hint).toContain('Max-Age=0');
    for (const name of ['wos-session', 'alfera_active_org']) {
      const expiry = find_parent_domain_expiry(set_cookies, name);
      expect(expiry).toContain('Domain=.example.com');
      expect(expiry).toContain('Max-Age=0');
    }
  });

  it('keeps the rotated host-only session cookie while expiring the parent-domain one', async () => {
    process.env.AUTH_HINT_COOKIE_DOMAIN = '.alfera.ai';
    signed_in({ rotated_session_set_cookie: 'wos-session=sealed-session; Path=/; HttpOnly' });

    const { response } = await run_middleware(
      new Request('https://app.alfera.ai/home', {
        headers: {
          accept: 'text/html',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
        },
      }),
    );
    const session_cookies = find_set_cookies(response.headers.getSetCookie(), 'wos-session');

    expect(response.status).toBe(200);
    expect(session_cookies).toHaveLength(2);
    expect(session_cookies.filter((cookie) => !cookie.includes('Domain='))).toEqual([
      expect.stringContaining('wos-session=sealed-session'),
    ]);
    expect(session_cookies.filter((cookie) => cookie.includes('Domain=.alfera.ai'))).toEqual([
      expect.stringContaining('Max-Age=0'),
    ]);
  });

  it('still writes the rotated session cookie when the handler throws', async () => {
    signed_in({ rotated_session_set_cookie: 'wos-session=rotated; Path=/; HttpOnly' });

    const { response } = await run_middleware(
      new Request('https://app.example/home', { headers: { host: 'app.example' } }),
      'router',
      { next_error: new Error('boom') },
    );

    expect(response.status).toBe(500);
    expect(response.headers.getSetCookie()).toContainEqual('wos-session=rotated; Path=/; HttpOnly');
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ mechanism: { handled: false } }),
    );
  });

  it('rethrows a handler error when no session was rotated', async () => {
    signed_in();

    await expect(
      run_middleware(
        new Request('https://app.example/home', { headers: { host: 'app.example' } }),
        'router',
        { next_error: new Error('boom') },
      ),
    ).rejects.toThrow('boom');
  });

  it('never drops the Set-Cookie headers the rest of the app already wrote', async () => {
    process.env.AUTH_HINT_COOKIE_DOMAIN = '.alfera.ai';
    signed_in({ rotated_session_set_cookie: 'wos-session=sealed-session; Path=/; HttpOnly' });

    const { response } = await run_middleware(
      new Request('https://app.alfera.ai/home', {
        headers: {
          accept: 'text/html',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
        },
      }),
      'router',
      { route_set_cookie: 'alfera_attribution=%7B%7D; Path=/' },
    );
    const set_cookies = response.headers.getSetCookie();

    expect(set_cookies).toContainEqual('wos-session=sealed-session; Path=/; HttpOnly');
    expect(set_cookies).toContainEqual('alfera_attribution=%7B%7D; Path=/');
    expect(find_set_cookie(set_cookies, 'alfera_authed')).toContain('alfera_authed=1');
  });

  it('expires the parent-domain PKCE verifiers the request carries', async () => {
    process.env.AUTH_HINT_COOKIE_DOMAIN = '.alfera.ai';

    const { response } = await run_middleware(
      new Request('https://app.alfera.ai/home', {
        headers: {
          accept: 'text/html',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          cookie: 'wos-auth-verifier-24f8f687=state; alfera_attribution=%7B%7D',
        },
      }),
    );
    const set_cookies = response.headers.getSetCookie();

    expect(find_parent_domain_expiry(set_cookies, 'wos-auth-verifier-24f8f687')).toContain(
      'Max-Age=0',
    );
    expect(find_set_cookie(set_cookies, 'alfera_attribution')).toBeUndefined();
  });

  it('expires parent-domain session cookies on the 401 for unauthenticated data fetches', async () => {
    process.env.AUTH_HINT_COOKIE_DOMAIN = '.alfera.ai';

    const { response } = await run_middleware(
      new Request('https://app.alfera.ai/settings', {
        headers: { accept: 'text/x-component', 'sec-fetch-dest': 'empty' },
      }),
    );
    const set_cookies = response.headers.getSetCookie();

    expect(response.status).toBe(401);
    for (const name of ['wos-session', 'alfera_active_org']) {
      expect(find_parent_domain_expiry(set_cookies, name)).toContain('Max-Age=0');
    }
  });

  it('expires nothing on the parent domain when no hint domain is configured', async () => {
    const { response } = await run_middleware(
      new Request('http://app.localhost:3000/home', {
        headers: {
          accept: 'text/html',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
        },
      }),
    );
    const set_cookies = response.headers.getSetCookie();

    expect(find_parent_domain_expiry(set_cookies, 'wos-session')).toBeUndefined();
    expect(set_cookies.join('\n')).not.toContain('Domain=');
  });

  it('expires a dead session cookie the request still carries', async () => {
    mocks.authenticate_session_cookie.mockResolvedValue({
      auth: { user: null },
      expired_session_set_cookie: 'wos-session=; Path=/; Max-Age=0',
    });

    const { response } = await run_middleware(
      new Request('http://app.localhost:3000/home', {
        headers: {
          accept: 'text/html',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          cookie: 'wos-session=dead',
        },
      }),
    );

    expect(response.headers.getSetCookie()).toContainEqual('wos-session=; Path=/; Max-Age=0');
  });

  it('passes static asset requests through without authenticating', async () => {
    for (const pathname of ['/_build/assets/app.js', '/assets/icon.png']) {
      const { response, next } = await run_middleware(
        new Request(`https://app-dev.example.com${pathname}`),
      );

      expect(next).toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(mocks.authenticate_session_cookie).not.toHaveBeenCalled();
    }
  });

  it('passes the Sentry tunnel through without authenticating or touching the response', async () => {
    const { response, next } = await run_middleware(
      new Request('https://app-dev.example.com/monitoring', { method: 'POST', body: 'envelope' }),
    );

    expect(next).toHaveBeenCalled();
    expect(mocks.authenticate_session_cookie).not.toHaveBeenCalled();
    expect(response.headers.get('x-robots-tag')).toBeNull();
  });

  it('does not gate API proxy requests', async () => {
    const { response, next } = await run_middleware(
      new Request('https://app-dev.example.com/api/v1/apps'),
    );

    expect(next).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-coworker-auth-required')).toBeNull();
  });

  it('proxies sandbox preview hosts to the API instead of rendering the app', async () => {
    const request = new Request(
      `https://demo.${sandbox_preview_base_domain}/_build/assets/app.js`,
      {
        headers: { host: `demo.${sandbox_preview_base_domain}` },
      },
    );

    const { response, next } = await run_middleware(request);

    expect(mocks.proxy_sandbox_preview).toHaveBeenCalledWith(request);
    expect(next).not.toHaveBeenCalled();
    expect(await response.text()).toBe('preview');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('primes the session for server-function calls instead of gating them', async () => {
    const user = { id: 'user_1' };
    signed_in({ user, rotated_session_set_cookie: 'wos-session=rotated; Path=/; HttpOnly' });
    const request = new Request('https://app.alfera.ai/_serverFn/settings_update', {
      method: 'POST',
      headers: { cookie: 'wos-session=sealed', 'sec-fetch-dest': 'empty' },
      body: '{}',
    });

    const { response, next } = await run_middleware(request, 'serverFn');

    expect(mocks.authenticate_session_cookie).toHaveBeenCalledWith('sealed');
    expect(mocks.prime_request_auth).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ auth: { user } }),
    );
    expect(next).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toContainEqual('wos-session=rotated; Path=/; HttpOnly');
  });

  it('lets an unauthenticated server-function call through to the function itself', async () => {
    const { response, next } = await run_middleware(
      new Request('https://app.alfera.ai/_serverFn/settings_update', { method: 'POST' }),
      'serverFn',
    );

    expect(next).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-coworker-auth-required')).toBeNull();
  });

  it('primes the request with the session it authenticated', async () => {
    const user = { id: 'user_1' };
    signed_in({ user });
    const request = new Request('https://app.alfera.ai/home', {
      headers: {
        accept: 'text/html',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        cookie: 'wos-session=sealed',
      },
    });

    await run_middleware(request);

    expect(mocks.authenticate_session_cookie).toHaveBeenCalledWith('sealed');
    expect(mocks.prime_request_auth).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ auth: { user } }),
    );
  });
});

function signed_out() {
  mocks.authenticate_session_cookie.mockResolvedValue({ auth: { user: null } });
}

function signed_in(session: Partial<SessionAuthentication> & { user?: { id: string } } = {}) {
  const { user, ...rest } = session;
  mocks.authenticate_session_cookie.mockResolvedValue({
    auth: { user: user ?? { id: 'user_1' } },
    ...rest,
  });
}

async function run_middleware(
  request: Request,
  handler_type: 'router' | 'serverFn' = 'router',
  { route_set_cookie, next_error }: { route_set_cookie?: string; next_error?: Error } = {},
) {
  const next = vi.fn(async () => {
    if (next_error) throw next_error;
    const response = new Response(null, { status: 200 });
    if (route_set_cookie) response.headers.append('Set-Cookie', route_set_cookie);
    return { response };
  });

  const server = app_request_middleware.options.server as unknown as (options: {
    request: Request;
    next: typeof next;
    handlerType: 'router' | 'serverFn';
    pathname: string;
    context: Record<string, never>;
  }) => Promise<Response | { response: Response }>;

  const result = await server({
    request,
    next,
    handlerType: handler_type,
    pathname: new URL(request.url).pathname,
    context: {},
  });

  return { response: result instanceof Response ? result : result.response, next };
}

function find_set_cookie(set_cookies: string[], name: string) {
  return set_cookies.find((cookie) => cookie.startsWith(`${name}=`));
}

function find_parent_domain_expiry(set_cookies: string[], name: string) {
  return set_cookies.find((cookie) => cookie.startsWith(`${name}=;`) && cookie.includes('Domain='));
}

function find_set_cookies(set_cookies: string[], name: string) {
  return set_cookies.filter((cookie) => cookie.startsWith(`${name}=`));
}

describe('request middleware on server-function calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signed_out();
  });

  it('writes the rotated session cookie', async () => {
    signed_in({ rotated_session_set_cookie: 'wos-session=rotated; Path=/; HttpOnly' });

    const { response } = await run_middleware(server_fn_request(), 'serverFn');

    expect(response.headers.getSetCookie()).toContainEqual('wos-session=rotated; Path=/; HttpOnly');
  });

  it('sets the shared auth hint and the robots header like every other response', async () => {
    signed_in();

    const { response } = await run_middleware(server_fn_request(), 'serverFn');

    expect(find_set_cookie(response.headers.getSetCookie(), 'alfera_authed')).toContain(
      'alfera_authed=1',
    );
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('clears the auth hint when the call carries no session', async () => {
    const { response } = await run_middleware(server_fn_request(), 'serverFn');

    expect(find_set_cookie(response.headers.getSetCookie(), 'alfera_authed')).toContain(
      'alfera_authed=;',
    );
  });

  it('returns the tunnel response untouched even when its headers are immutable', async () => {
    const request = new Request('https://app.example/monitoring', {
      method: 'POST',
      headers: { host: 'app.example', 'content-type': 'application/x-sentry-envelope' },
      body: '{}',
    });
    const tunnel_response = new Response('ok', { status: 200 });
    vi.spyOn(tunnel_response.headers, 'set').mockImplementation(() => {
      throw new TypeError('immutable');
    });
    const next = vi.fn(async () => ({ response: tunnel_response }));

    const server = app_request_middleware.options.server as unknown as (options: {
      request: Request;
      next: typeof next;
      handlerType: 'router';
      pathname: string;
      context: Record<string, never>;
    }) => Promise<Response | { response: Response }>;
    const result = await server({
      request,
      next,
      handlerType: 'router',
      pathname: '/monitoring',
      context: {},
    });
    const response = result instanceof Response ? result : result.response;

    expect(response.status).toBe(200);
    expect(mocks.authenticate_session_cookie).not.toHaveBeenCalled();
  });
});

function server_fn_request() {
  return new Request('https://app.example/_serverFn/load_template_catalog', {
    headers: { host: 'app.example' },
  });
}
