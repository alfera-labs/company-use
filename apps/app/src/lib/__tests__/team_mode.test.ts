import { local_mode_identity } from '@coworker/config/local_mode_switch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { team_sign_in_notice_words } from '@/components/app/team_sign_in_notice_toast';
import { local_user_id } from '@/lib/local_identity';
import { authenticate_request, local_organization_id } from '@/lib/local_mode';
import { is_onboarding_this_persons_job, read_team_arrival } from '@/lib/team_arrival';
import { join_team_with_link, show_team_join_page } from '@/lib/team_join';
import {
  apply_team_mode_frame_headers,
  hint_may_be_secure,
  refuse_request_in_team_mode,
  team_session_cookie_name,
} from '@/lib/team_mode';
import { team_session_ended_header } from '@/lib/team_session_ended';
import { prime_request_auth } from '@/lib/workos_session';
import { sign_out_response } from '@/routes/auth/sign-out';

const caller = vi.hoisted(() => ({ request: new Request('http://x/') }));

vi.mock('@tanstack/react-start/server', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start/server')>()),
  getRequest: () => caller.request,
}));

const proxy_secret = 'the-proxy-secret-of-this-test';
const session_token = 's'.repeat(43);
const link_token = 't'.repeat(43);
const person = {
  user_id: 'user_7',
  first_name: 'Lin',
  last_name: null,
  organization_id: 'org_local',
};

type ApiCall = { path: string; body: Record<string, string>; headers: Headers };
type ApiAnswer = { status: number; data?: unknown; error?: unknown };
let api_calls: ApiCall[];
let api_answers: Record<string, (body: Record<string, string>) => ApiAnswer>;

async function answer_as_the_api(input: string | URL | Request, init?: RequestInit) {
  const path = new URL(String(input)).pathname.replace(/^\/v1\/(team-sign-in\/)?/u, '');
  const body = z.record(z.string(), z.string()).parse(JSON.parse(String(init?.body ?? '{}')));
  api_calls.push({ path, body, headers: new Headers(init?.headers) });
  const answer = api_answers[path]?.(body) ?? { status: 404 };
  return Response.json({ data: answer.data, error: answer.error }, { status: answer.status });
}

function calls_to(path: string) {
  return api_calls.filter((call) => call.path === path);
}

function request_for(
  path: string,
  init: { method?: string; headers?: Record<string, string>; origin?: string } = {},
) {
  const origin = init.origin ?? 'http://192.168.1.10:3000';
  return new Request(`${origin}${path}`, {
    method: init.method ?? 'GET',
    headers: { host: new URL(origin).host, accept: 'text/html', ...init.headers },
  });
}

const signed_in = { cookie: `${team_session_cookie_name}=${session_token}` };
const from_own_page = { origin: 'http://192.168.1.10:3000' };

beforeEach(() => {
  vi.stubEnv('COWORKER_AUTH_MODE', 'team');
  vi.stubEnv('WORKOS_API_KEY', '');
  vi.stubEnv('WORKOS_CLIENT_ID', '');
  vi.stubEnv('COWORKER_API_PROXY_SECRET', proxy_secret);
  vi.stubGlobal('fetch', answer_as_the_api);
  api_calls = [];
  api_answers = {
    session: (body) =>
      body.session_token === session_token ? { status: 200, data: person } : { status: 401 },
    'session/end': () => ({ status: 200, data: { ended: true } }),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('with the switch unset', () => {
  it('refuses nothing and asks the API nothing, so the hosted path is as it was', async () => {
    for (const mode of ['', 'workos', 'local', 'Team']) {
      vi.stubEnv('COWORKER_AUTH_MODE', mode);
      const cross_site_write = request_for('/chats', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site', ...signed_in },
      });
      expect(await refuse_request_in_team_mode(cross_site_write)).toBeNull();
      expect(await refuse_request_in_team_mode(request_for(`/join/${link_token}`))).toBeNull();
    }
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    const { auth } = await authenticate_request(request_for('/chats', { headers: signed_in }));
    expect(auth.user).toBeNull();
    expect(api_calls).toEqual([]);
  });
});

describe('what team mode serves without a session', () => {
  it('serves the files of the app, the join, setup, sign-in and deploy pages, and nothing else', async () => {
    const open_paths = [
      '/_build/assets/app.js',
      '/assets/app.css',
      '/favicon.ico',
      '/setup',
      '/sign-in',
      '/deploy',
      '/auth/session',
      '/auth/setup/check',
      '/auth/password/sign-in',
    ];
    for (const path of open_paths) {
      expect(await refuse_request_in_team_mode(request_for(path))).toBeNull();
    }
    expect(await refuse_request_in_team_mode(request_for(`/join/${link_token}`))).toBeNull();
    expect(api_calls).toEqual([]);

    const closed_paths = [
      '/',
      '/chats',
      '/settings/team',
      '/sign-up',
      '/setup/x',
      '/auth/setups/check',
      '/auth/callback',
      '/auth/test-login',
      '/callback',
      '/connect/start',
      '/product-demo',
      '/api/v1/sessions',
      '/_serverFn/abc',
      '/_widgets/x',
      '/monitoring',
      '/join',
      '/design-system',
    ];
    for (const path of closed_paths) {
      const refusal = await refuse_request_in_team_mode(request_for(path));
      expect(refusal?.status, path).toBe(303);
      const back_to = path === '/' ? '' : `?returnTo=${encodeURIComponent(path)}`;
      expect(refusal?.headers.get('location'), path).toBe(`/sign-in${back_to}`);
    }
  });

  it('sends a page to the sign-in page and answers a data request with a 401 the app understands', async () => {
    const page = await refuse_request_in_team_mode(request_for('/chats'));
    expect(page?.status).toBe(303);
    expect(page?.headers.get('location')).toBe('/sign-in?returnTo=%2Fchats');

    const data = await refuse_request_in_team_mode(
      request_for('/api/v1/sessions', { headers: { accept: 'application/json' } }),
    );
    expect(data?.status).toBe(401);
    expect(data?.headers.get('x-coworker-auth-required')).toBe('1');
    expect(JSON.stringify(await data?.json())).toContain('./alfera team link');
  });

  it('lets the signed-in hint cookie be Secure only where the session cookie is Secure', () => {
    expect(hint_may_be_secure(new Request('http://192.168.1.20:3000/'))).toBe(false);
    expect(hint_may_be_secure(new Request('https://alfera.example.com/'))).toBe(true);
    const behind_a_proxy = { headers: { 'x-forwarded-proto': 'https' } };
    expect(hint_may_be_secure(new Request('http://app:3000/', behind_a_proxy))).toBe(true);
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    expect(hint_may_be_secure(new Request('http://app:3000/'))).toBe(true);
  });

  it('gives a caller that names localhost the same page, and asks the API nothing', async () => {
    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://LOCALHOST:3000',
    ]) {
      const refusal = await refuse_request_in_team_mode(request_for('/chats', { origin }));
      expect(refusal?.headers.get('location')).toBe('/sign-in?returnTo=%2Fchats');
      const data = await refuse_request_in_team_mode(
        request_for('/api/v1/sessions', { origin, headers: { accept: 'application/json' } }),
      );
      expect(data?.status).toBe(401);
    }
    expect(api_calls).toEqual([]);
  });

  it('refuses a session the API does not know, and takes the cookie back', async () => {
    const stale = { cookie: `${team_session_cookie_name}=${'x'.repeat(43)}` };
    const refusal = await refuse_request_in_team_mode(request_for('/chats', { headers: stale }));
    expect(refusal?.status).toBe(303);
    expect(refusal?.headers.get('set-cookie')).toContain(`${team_session_cookie_name}=; `);
    expect(refusal?.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('tells the open app to load the page again when a request for data has no session', async () => {
    const stale = { cookie: `${team_session_cookie_name}=${'x'.repeat(43)}`, accept: '*/*' };
    const refusal = await refuse_request_in_team_mode(request_for('/home', { headers: stale }));

    expect(refusal?.status).toBe(401);
    expect(refusal?.headers.get(team_session_ended_header)).toBe('1');
  });

  it('does not read an API outage as a signed-out person', async () => {
    api_answers.session = () => ({ status: 503 });
    await expect(
      refuse_request_in_team_mode(request_for('/chats', { headers: signed_in })),
    ).rejects.toThrow(/503/);
  });
});

describe('what team mode serves a person who was removed', () => {
  const removed = { cookie: `${team_session_cookie_name}=${'r'.repeat(43)}` };

  beforeEach(() => {
    api_answers.session = () => ({
      status: 401,
      error: { code: 'team_member_removed', details: { workspace_name: 'Acme' } },
    });
  });

  it('shows one plain page that says her access ended, and not the page that asks for a link', async () => {
    const page = await refuse_request_in_team_mode(
      request_for('/chats/ses_1', { headers: removed }),
    );
    const html = await page?.text();

    expect(page?.status).toBe(403);
    expect(html).toContain('Your access to Acme has ended');
    expect(html).not.toContain('needs a sign-in link');
  });

  it('keeps her cookie, so the next page says the same until she opens a new link', async () => {
    const page = await refuse_request_in_team_mode(request_for('/chats', { headers: removed }));

    expect(page?.headers.get('set-cookie')).toBeNull();
    expect(await refuse_request_in_team_mode(request_for(`/join/${link_token}`))).toBeNull();
  });

  it('answers the next request of the open app with the order to load the page again', async () => {
    const data_request = request_for('/home', { headers: { ...removed, accept: '*/*' } });
    const refusal = await refuse_request_in_team_mode(data_request);

    expect(refusal?.status).toBe(401);
    expect(refusal?.headers.get(team_session_ended_header)).toBe('1');
    expect(await refusal?.json()).toMatchObject({ error: { code: 'team_member_removed' } });
  });

  it('signs her in as nobody', async () => {
    const { auth } = await authenticate_request(request_for('/chats', { headers: removed }));

    expect(auth.user).toBeNull();
  });
});

describe('what team mode serves with a session', () => {
  it('serves the person the API names, and asks once for each request', async () => {
    const request = request_for('/chats', { headers: signed_in });
    expect(await refuse_request_in_team_mode(request)).toBeNull();
    const { auth } = await authenticate_request(request);
    expect(auth.user).toMatchObject({ id: 'user_7', firstName: 'Lin', email: '' });
    expect(auth.organizationId).toBe('org_local');
    expect(calls_to('session')).toHaveLength(1);
    expect(calls_to('session')[0]?.headers.get('x-coworker-api-secret')).toBe(proxy_secret);
    expect(calls_to('session')[0]?.headers.has('x-coworker-auth-user-id')).toBe(false);
  });

  it('refuses a write from another site, with or without a session', async () => {
    const writes = [
      { 'sec-fetch-site': 'cross-site', origin: 'https://attacker.example' },
      { 'sec-fetch-site': 'same-site' },
      { origin: 'https://attacker.example' },
      {},
    ];
    for (const path of ['/api/v1/team/invitations', `/join/${link_token}`, '/auth/sign-out']) {
      for (const headers of writes) {
        const request = request_for(path, {
          method: 'POST',
          headers: { ...headers, ...signed_in },
        });
        expect((await refuse_request_in_team_mode(request))?.status, path).toBe(403);
      }
    }
    const own_write = request_for('/api/v1/team/invitations', {
      method: 'POST',
      headers: { ...from_own_page, ...signed_in },
    });
    expect(await refuse_request_in_team_mode(own_write)).toBeNull();
  });

  it('takes a form POST that carries no Origin when the browser proves the page another way', async () => {
    const own_page = 'http://192.168.1.10:3000/settings/team';
    const post_with = (headers: Record<string, string>) =>
      refuse_request_in_team_mode(
        request_for('/auth/sign-out', { method: 'POST', headers: { ...headers, ...signed_in } }),
      );

    expect(await post_with({ 'sec-fetch-site': 'same-origin' })).toBeNull();
    expect(await post_with({ referer: own_page })).toBeNull();
    expect(await post_with({ referer: 'http://192.168.1.10:3000' })).toBeNull();
    expect((await post_with({}))?.status).toBe(403);
    expect((await post_with({ referer: 'https://attacker.example/page' }))?.status).toBe(403);
    expect((await post_with({ referer: 'not an address' }))?.status).toBe(403);
    expect((await post_with({ origin: 'null', referer: own_page }))?.status).toBe(403);
    expect(
      (await post_with({ origin: 'https://attacker.example', referer: own_page }))?.status,
    ).toBe(403);
    expect((await post_with({ 'sec-fetch-site': 'cross-site', referer: own_page }))?.status).toBe(
      403,
    );
  });

  it('compares host names without regard to case', async () => {
    const mixed_case = new Request('http://192.168.1.10:3000/auth/sign-out', {
      method: 'POST',
      headers: { host: 'Alfera.Example.COM', origin: 'https://alfera.example.com', ...signed_in },
    });
    expect(await refuse_request_in_team_mode(mixed_case)).toBeNull();
  });

  it('refuses every request when the sign-in provider keys are set beside team mode', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('WORKOS_API_KEY', 'a_provider_key');
    const refusal = await refuse_request_in_team_mode(
      request_for('/chats', { headers: signed_in }),
    );
    expect(refusal?.status).toBe(500);
    const said_to_the_caller = (await refusal?.text()) ?? '';
    expect(said_to_the_caller).toBe(
      'This install is not set up correctly. The server log says what to change.',
    );
    expect(said_to_the_caller).not.toMatch(/WORKOS|COWORKER_AUTH_MODE/u);
    expect(logged.mock.calls.flat().join(' ')).toContain('WORKOS_API_KEY is set');
  });
});

describe('the join page', () => {
  it('shows who the link is for without using it up, and escapes what a person typed', async () => {
    api_answers['link/preview'] = () => ({
      status: 200,
      data: { workspace_name: '<script>alert(1)</script> & Co', person_name: 'Lin "the" <b>' },
    });
    const page = await show_team_join_page(link_token);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co');
    expect(html).toContain('Lin &quot;the&quot; &lt;b&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<form method="post">');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(page.headers.get('referrer-policy')).toBe('same-origin');
    expect(calls_to('link/redeem')).toEqual([]);
  });

  it('is signed in by the POST a browser sends from the page on plain http', async () => {
    api_answers['link/redeem'] = () => ({
      status: 201,
      data: { session_token, max_age_seconds: 60 },
    });
    const from_the_join_page = request_for(`/join/${link_token}`, {
      method: 'POST',
      headers: {
        origin: 'http://192.168.1.10:3000',
        referer: `http://192.168.1.10:3000/join/${link_token}`,
      },
    });
    expect(await refuse_request_in_team_mode(from_the_join_page)).toBeNull();
    expect((await join_team_with_link(from_the_join_page, link_token)).status).toBe(303);

    const under_a_no_referrer_policy = request_for(`/join/${link_token}`, {
      method: 'POST',
      headers: { origin: 'null' },
    });
    expect((await refuse_request_in_team_mode(under_a_no_referrer_policy))?.status).toBe(403);
  });

  it('answers every bad link with the same page', async () => {
    api_answers['link/preview'] = () => ({ status: 404 });
    api_answers['link/redeem'] = () => ({ status: 404 });
    const looked = await show_team_join_page(link_token);
    const posted = await join_team_with_link(
      request_for(`/join/${link_token}`, { method: 'POST', headers: from_own_page }),
      link_token,
    );
    expect([looked.status, posted.status]).toEqual([404, 404]);
    expect(await looked.text()).toBe(await posted.text());
    expect(posted.headers.get('set-cookie')).toBeNull();
  });

  it('starts a session with a cookie scripts cannot read, bound to the host over https', async () => {
    api_answers['link/redeem'] = () => ({
      status: 201,
      data: { session_token, max_age_seconds: 2_592_000 },
    });
    const over_http = await join_team_with_link(
      request_for(`/join/${link_token}`, { method: 'POST', headers: from_own_page }),
      link_token,
    );
    expect(over_http.status).toBe(303);
    expect(over_http.headers.get('location')).toBe('/');
    expect(over_http.headers.get('set-cookie')).toBe(
      `${team_session_cookie_name}=${session_token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`,
    );

    for (const https_request of [
      request_for(`/join/${link_token}`, { method: 'POST', origin: 'https://alfera.example.com' }),
      request_for(`/join/${link_token}`, {
        method: 'POST',
        headers: { 'x-forwarded-proto': 'https' },
      }),
    ]) {
      const over_https = await join_team_with_link(https_request, link_token);
      expect(over_https.headers.get('set-cookie')).toBe(
        `__Host-${team_session_cookie_name}=${session_token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure`,
      );
    }
  });

  it('reads the session over https only from the host-bound cookie', async () => {
    const over_https = (cookie_name: string) =>
      refuse_request_in_team_mode(
        request_for('/chats', {
          origin: 'https://alfera.example.com',
          headers: { cookie: `${cookie_name}=${session_token}` },
        }),
      );
    expect(await over_https(`__Host-${team_session_cookie_name}`)).toBeNull();
    expect((await over_https(team_session_cookie_name))?.status).toBe(303);
    const over_http = await refuse_request_in_team_mode(
      request_for('/chats', {
        headers: { cookie: `__Host-${team_session_cookie_name}=${session_token}` },
      }),
    );
    expect(over_http?.status).toBe(303);
  });

  it('ends the session the browser had before it starts the new one', async () => {
    api_answers['link/redeem'] = () => ({
      status: 201,
      data: { session_token: 'n'.repeat(43), max_age_seconds: 60 },
    });
    await join_team_with_link(
      request_for(`/join/${link_token}`, {
        method: 'POST',
        headers: { ...from_own_page, ...signed_in },
      }),
      link_token,
    );
    expect(calls_to('session/end').map((call) => call.body)).toEqual([{ session_token }]);
  });

  it('keeps no count of tries, so no person can lock the others out of joining', async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(await refuse_request_in_team_mode(request_for(`/join/${link_token}`))).toBeNull();
    }
  });
});

describe('sign-out in team mode', () => {
  it('ends the stored session and takes the cookie back', async () => {
    const response = await sign_out_response(
      request_for('/auth/sign-out', {
        method: 'POST',
        headers: { ...from_own_page, ...signed_in },
      }),
    );
    expect(response.status).toBe(303);
    expect(calls_to('session/end').map((call) => call.body)).toEqual([{ session_token }]);
    expect(response.headers.get('set-cookie')).toContain(`${team_session_cookie_name}=; `);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('is refused from another site', async () => {
    const response = await sign_out_response(
      request_for('/auth/sign-out', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site', ...signed_in },
      }),
    );
    expect(response.status).toBe(403);
    expect(calls_to('session/end')).toEqual([]);
  });
});

describe('what the app learns when a person arrives', () => {
  async function arrival_of(viewer_role: string, sign_in_notice: unknown = null) {
    const request = request_for('/home', { headers: signed_in });
    prime_request_auth(request, await authenticate_request(request));
    caller.request = request;
    api_answers['team/arrival'] = () => ({ status: 200, data: { viewer_role, sign_in_notice } });
    return read_team_arrival();
  }

  it('makes onboarding the owner job, so a person who joined by a link goes straight in', async () => {
    expect(is_onboarding_this_persons_job(await arrival_of('owner'))).toBe(true);
    expect(is_onboarding_this_persons_job(await arrival_of('admin'))).toBe(false);
    expect(is_onboarding_this_persons_job(await arrival_of('member'))).toBe(false);
    expect(calls_to('team/arrival').at(-1)?.headers.get('x-coworker-auth-user-id')).toBe('user_7');
  });

  it('carries the notice about the sign-in before this one, in words that name who made the link', async () => {
    const notice = {
      made_by_name: 'Ada',
      used_time: '2026-10-12T08:30:00.000Z',
      link_kind: 'new_link' as const,
    };
    const arrival = await arrival_of('member', notice);
    expect(arrival.sign_in_notice).toEqual(notice);
    const words = team_sign_in_notice_words(notice, 'member');
    expect(words).toContain('Your sign-in before this one: ');
    expect(words).toContain('with a new sign-in link made by Ada');
    expect(words).toContain('If that was not you, tell an owner');
    const for_the_owner = team_sign_in_notice_words(notice, 'owner');
    expect(for_the_owner).not.toContain('tell an owner');
    expect(for_the_owner).toContain('./alfera team link');
    expect(team_sign_in_notice_words({ ...notice, link_kind: 'invitation' }, 'member')).toContain(
      'with the invitation made by Ada',
    );
    const from_the_server = { ...notice, link_kind: 'command_line' as const };
    expect(team_sign_in_notice_words(from_the_server, 'owner')).toContain(
      'with a link from the command line of the server. If that was not you',
    );
  });

  it('asks the API nothing outside team mode, where onboarding is everybody job', async () => {
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    api_calls = [];
    const arrival = await read_team_arrival();
    expect(arrival).toEqual({ viewer_role: null, sign_in_notice: null });
    expect(is_onboarding_this_persons_job(arrival)).toBe(true);
    expect(api_calls).toEqual([]);
  });
});

describe('frames', () => {
  it('lets no other site frame a page of a team-mode install, and changes nothing elsewhere', () => {
    const in_team_mode = new Response('page');
    apply_team_mode_frame_headers(in_team_mode);
    expect(in_team_mode.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
    expect(in_team_mode.headers.get('x-frame-options')).toBe('SAMEORIGIN');

    const with_its_own_policy = new Response('page', {
      headers: { 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" },
    });
    apply_team_mode_frame_headers(with_its_own_policy);
    expect(with_its_own_policy.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );

    vi.stubEnv('COWORKER_AUTH_MODE', '');
    const hosted = new Response('page');
    apply_team_mode_frame_headers(hosted);
    expect([...hosted.headers.keys()]).not.toContain('content-security-policy');
    expect([...hosted.headers.keys()]).not.toContain('x-frame-options');
  });
});

describe('the one workspace', () => {
  it('is named the same way by the app and by the API', () => {
    expect(local_mode_identity.provider_user_id).toBe(local_user_id);
    expect(local_mode_identity.organization_id).toBe(local_organization_id);
  });
});
