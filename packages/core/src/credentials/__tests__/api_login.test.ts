import { sign_in_with_api_login } from '@coworker/core/credentials/api_login';
import {
  type ApiLoginResult,
  api_login_recipe_schema,
} from '@coworker/core/credentials/api_login_recipe';
import { describe, expect, it, vi } from 'vitest';

type SignedIn = Extract<ApiLoginResult, { signed_in: true }>;

const recipe = api_login_recipe_schema.parse({
  visit_first: 'https://www.acmebooking.com/signin',
  post_credentials_to: 'https://www.acmebooking.com/api/account/signin',
  send_fields: { username: 'username', password: 'password' },
  echo_cookie_into_header: { cookie_named: 'XSRF-TOKEN', into_header: 'X-XSRF-TOKEN' },
  always_send_headers: {
    'X-Vendor-API-Version': '2019-06-10',
    'X-Requested-With': 'XMLHttpRequest',
  },
  successful_when_field: 'result',
  successful_when_value: 'success',
  rejected_when_any_field_present: ['SIGNIN_FAIL'],
  read_wait_minutes_from_field: 'PASSWORD_WAIT',
  session_lasts_minutes: 1440,
  keep_cookies_named: ['session', 'XSRF-TOKEN'],
});

const field_values = { username: 'test-account@example.invalid', password: 'not-a-real-password' };
const allowed_hosts = ['www.acmebooking.com'];
const lookup_addresses = async () => ['93.184.216.34'];

function create_response(body: unknown, set_cookie: string[] = []) {
  return {
    status: 200,
    headers: { getSetCookie: () => set_cookie, get: () => 'application/json' },
    json: async () => body,
  } as unknown as Response;
}

function create_html_response(status: number) {
  return {
    status,
    headers: { getSetCookie: () => [], get: () => 'text/html; charset=utf-8' },
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    },
  } as unknown as Response;
}

function create_redirect(status: number) {
  return {
    status,
    headers: { getSetCookie: () => [], get: () => 'text/html' },
    json: async () => null,
  } as unknown as Response;
}

const visitor_cookies = ['session=abc123; Path=/; HttpOnly', 'XSRF-TOKEN=xsrf789; Path=/'];

describe('sign_in_with_api_login', () => {
  it('visits first so the vendor can mint its anti-forgery cookie', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(create_response({ result: 'success' }));

    await sign_in_with_api_login({
      recipe,
      field_values,
      allowed_hosts,
      lookup_addresses,
      send_request: send,
    });

    expect(send.mock.calls[0]?.[0]).toBe('https://www.acmebooking.com/signin');
    expect(send.mock.calls[1]?.[0]).toBe('https://www.acmebooking.com/api/account/signin');
  });

  it.each([
    ['the first visit', 0],
    ['the sign-in request', 1],
  ])('refuses to follow a redirect on %s', async (_name, redirect_at) => {
    const send = vi.fn(async (...args: unknown[]) => {
      void args;
      return send.mock.calls.length - 1 === redirect_at
        ? create_redirect(307)
        : create_response('', visitor_cookies);
    });

    const result = await sign_in_with_api_login({
      recipe,
      field_values,
      allowed_hosts,
      lookup_addresses,
      send_request: send as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ signed_in: false, outcome: 'misconfigured' });
    expect((result as { message: string }).message).toContain('another address');
    expect(send.mock.calls[redirect_at]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('echoes the anti-forgery cookie back as a header on the login itself', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(create_response({ result: 'success' }));

    await sign_in_with_api_login({
      recipe,
      field_values,
      allowed_hosts,
      lookup_addresses,
      send_request: send,
    });

    const login_headers = send.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(login_headers['X-XSRF-TOKEN']).toBe('xsrf789');
    expect(login_headers.Cookie).toContain('session=abc123');
  });

  it('sends the credential fields under the names the wire expects', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(create_response({ result: 'success' }));

    await sign_in_with_api_login({
      recipe,
      field_values,
      allowed_hosts,
      lookup_addresses,
      send_request: send,
    });

    expect(JSON.parse(String(send.mock.calls[1]?.[1]?.body))).toEqual({
      username: 'test-account@example.invalid',
      password: 'not-a-real-password',
    });
  });

  it('treats SIGNIN_FAIL as a failure even though the status is 200', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(create_response({ SIGNIN_FAIL: true }));

    const result = await sign_in_with_api_login({
      recipe,
      field_values,
      allowed_hosts,
      lookup_addresses,
      send_request: send,
    });

    expect(result).toMatchObject({ signed_in: false, outcome: 'rejected' });
  });

  it('reports a lockout countdown as rate limited, not as a retryable error', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(create_response({ PASSWORD_WAIT: 30 }));

    const result = await sign_in_with_api_login({
      recipe,
      field_values,
      allowed_hosts,
      lookup_addresses,
      send_request: send,
    });

    expect(result).toMatchObject({ signed_in: false, outcome: 'rate_limited', wait_minutes: 30 });
    expect((result as { message: string }).message).toContain('30 minutes');
  });

  it('refuses a 200 that never confirms success', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(create_response({ result: 'something_else' }));

    expect(
      await sign_in_with_api_login({
        recipe,
        field_values,
        allowed_hosts,
        lookup_addresses,
        send_request: send,
      }),
    ).toMatchObject({ signed_in: false });
  });

  it('keeps the visitor cookie when the vendor returns none of its own', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(create_response({ result: 'success' }, []));

    const result = await sign_in_with_api_login({
      recipe,
      field_values,
      allowed_hosts,
      lookup_addresses,
      send_request: send,
    });

    expect(result).toMatchObject({ signed_in: true });
    const { session_headers } = result as SignedIn;
    expect(session_headers.Cookie).toBe('session=abc123; XSRF-TOKEN=xsrf789');
    expect(session_headers['X-XSRF-TOKEN']).toBe('xsrf789');
  });

  it('keeps the API protocol headers out of the session headers', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(create_response({ result: 'success' }, []));

    const result = (await sign_in_with_api_login({
      recipe,
      field_values,
      allowed_hosts,
      lookup_addresses,
      send_request: send,
    })) as SignedIn;

    expect(Object.keys(result.session_headers).sort()).toEqual(['Cookie', 'X-XSRF-TOKEN']);
    expect(result.api_protocol_headers['X-Vendor-API-Version']).toBe('2019-06-10');
    expect(result.api_protocol_headers['X-Requested-With']).toBe('XMLHttpRequest');

    const on_both_sides = Object.keys(result.session_headers).filter(
      (name) => name in result.api_protocol_headers,
    );
    expect(on_both_sides).toEqual([]);
  });

  it('routes a credential-shaped recipe header to the session, not the published set', async () => {
    const recipe_with_a_secret = api_login_recipe_schema.parse({
      ...recipe,
      always_send_headers: {
        Authorization: 'Basic dXNlcjpwYXNzd29yZA==',
        'X-Api-Key': 'k_live_abc123',
        Accept: 'application/json',
      },
    });
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(create_response({ result: 'success' }, []));

    const result = (await sign_in_with_api_login({
      recipe: recipe_with_a_secret,
      field_values,
      allowed_hosts,
      lookup_addresses,
      send_request: send,
    })) as SignedIn;

    expect(result.api_protocol_headers).toEqual({ Accept: 'application/json' });
    expect(result.session_headers.Authorization).toBe('Basic dXNlcjpwYXNzd29yZA==');
    expect(result.session_headers['X-Api-Key']).toBe('k_live_abc123');
    expect(JSON.stringify(result.api_protocol_headers)).not.toContain('k_live_abc123');
  });

  it('prefers a cookie the login response does return', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(
        create_response({ result: 'success' }, ['session=rotated999; Path=/']),
      );

    const result = await sign_in_with_api_login({
      recipe,
      field_values,
      allowed_hosts,
      lookup_addresses,
      send_request: send,
    });

    expect((result as SignedIn).session_headers.Cookie).toContain('session=rotated999');
  });

  it('fails loudly when no session cookie survives the exchange', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', []))
      .mockResolvedValueOnce(create_response({ result: 'success' }, []));

    expect(
      await sign_in_with_api_login({
        recipe,
        field_values,
        allowed_hosts,
        lookup_addresses,
        send_request: send,
      }),
    ).toMatchObject({ signed_in: false });
  });

  it('raises rather than sending a request with a field it does not have', async () => {
    const send = vi.fn().mockResolvedValueOnce(create_response('', visitor_cookies));

    await expect(
      sign_in_with_api_login({
        recipe,
        field_values: { username: 'x' },
        allowed_hosts,
        lookup_addresses,
        send_request: send,
      }),
    ).rejects.toThrow('credential_field_missing:password');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rejects a recipe that keeps no cookies', () => {
    expect(() => api_login_recipe_schema.parse({ ...recipe, keep_cookies_named: [] })).toThrow();
  });

  it('names the status when the site answers with a page instead of JSON', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(create_html_response(404));

    const result = await sign_in_with_api_login({
      recipe,
      field_values,
      allowed_hosts,
      lookup_addresses,
      send_request: send,
    });

    expect(result).toMatchObject({ signed_in: false, outcome: 'misconfigured' });
    const { message } = result as { message: string };
    expect(message).toContain('404');
    expect(message).toContain('text/html');
    expect(message).toContain('missing something the site expects');
  });

  it('calls a server error unreachable rather than blaming the configuration', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(create_html_response(503));

    expect(
      await sign_in_with_api_login({
        recipe,
        field_values,
        allowed_hosts,
        lookup_addresses,
        send_request: send,
      }),
    ).toMatchObject({ signed_in: false, outcome: 'unreachable' });
  });

  it('refuses a recipe that points at a site the connection does not own', async () => {
    const send = vi.fn();
    const elsewhere = api_login_recipe_schema.parse({
      ...recipe,
      post_credentials_to: 'https://attacker.example/collect',
    });

    const result = await sign_in_with_api_login({
      recipe: elsewhere,
      field_values,
      allowed_hosts,
      lookup_addresses,
      send_request: send,
    });

    expect(result).toMatchObject({ signed_in: false, outcome: 'misconfigured' });
    expect(send).not.toHaveBeenCalled();
  });

  it('treats an absent success field as "no rejection marker is enough"', async () => {
    const without_success_check = api_login_recipe_schema.parse({
      ...recipe,
      successful_when_field: undefined,
      successful_when_value: undefined,
    });
    const send = vi
      .fn()
      .mockResolvedValueOnce(create_response('', visitor_cookies))
      .mockResolvedValueOnce(create_response({ anything: 'at all' }));

    expect(
      await sign_in_with_api_login({
        recipe: without_success_check,
        field_values,
        allowed_hosts,
        lookup_addresses,
        send_request: send,
      }),
    ).toMatchObject({ signed_in: true });
  });
});
