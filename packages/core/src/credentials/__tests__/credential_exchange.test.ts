import { parse_app_config } from '@coworker/core/credentials/app_credential_config';
import {
  credential_exchange_method_schema,
  run_credential_exchange,
} from '@coworker/core/credentials/credential_exchange';
import {
  drop_rules_from_a_previous_exchange,
  generate_delivery_rules_for_exchanged_headers,
  generate_exchanged_credential_values,
} from '@coworker/core/credentials/exchanged_credential_delivery';
import { afterEach, describe, expect, it, vi } from 'vitest';

const method = credential_exchange_method_schema.parse({
  exchange_kind: 'api_login',
  recipe: {
    visit_first: 'https://www.acmebooking.com/signin',
    post_credentials_to: 'https://www.acmebooking.com/api/account/signin',
    send_fields: { username: 'username', password: 'password' },
    echo_cookie_into_header: { cookie_named: 'XSRF-TOKEN', into_header: 'X-XSRF-TOKEN' },
    successful_when_field: 'result',
    successful_when_value: 'success',
    rejected_when_any_field_present: ['SIGNIN_FAIL'],
    read_wait_minutes_from_field: 'PASSWORD_WAIT',
    session_lasts_minutes: 1440,
    keep_cookies_named: ['session', 'XSRF-TOKEN'],
  },
});

const held_values = { username: 'test-account@example.invalid', password: 'not-a-real-password' };
const allowed_hosts = ['www.acmebooking.com'];

function answer(body: unknown, set_cookie: string[] = []) {
  return {
    headers: { getSetCookie: () => set_cookie },
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('run_credential_exchange', () => {
  it('never rejects — a dead site becomes an outcome, not an exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' })),
    );

    expect(await run_credential_exchange({ method, held_values, allowed_hosts })).toMatchObject({
      exchanged: false,
      outcome: 'unreachable',
    });
  });

  it('separates a missing field from an unreachable site', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer('', ['session=abc; Path=/'])));

    const result = await run_credential_exchange({
      method,
      held_values: { username: 'only' },
      allowed_hosts,
    });

    expect(result).toMatchObject({ exchanged: false, outcome: 'misconfigured' });
    expect((result as { message: string }).message).toContain('password');
  });

  it("passes the vendor's own wait through untouched", async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(answer('', ['session=abc; Path=/']))
        .mockResolvedValueOnce(answer({ PASSWORD_WAIT: 30 })),
    );

    expect(await run_credential_exchange({ method, held_values, allowed_hosts })).toMatchObject({
      exchanged: false,
      outcome: 'rate_limited',
      wait_minutes: 30,
    });
  });

  it('returns the same result shape whichever protocol produced it', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(answer('', ['session=abc; Path=/', 'XSRF-TOKEN=xyz; Path=/']))
        .mockResolvedValueOnce(answer({ result: 'success' })),
    );

    expect(await run_credential_exchange({ method, held_values, allowed_hosts })).toEqual({
      exchanged: true,
      session_lasts_minutes: 1440,
      deliver_as_headers: { Cookie: 'session=abc; XSRF-TOKEN=xyz', 'X-XSRF-TOKEN': 'xyz' },
      api_protocol_headers: {},
    });
  });

  it('refuses a recipe it does not know how to run', () => {
    expect(() =>
      credential_exchange_method_schema.parse({ exchange_kind: 'telepathy', recipe: {} }),
    ).toThrow();
  });

  it('defaults a password-shaped exchange to a single attempt', () => {
    expect(method.stop_after_failed_attempts).toBe(1);
  });
});

describe('exchanged credential delivery', () => {
  const headers = { Cookie: 'session=abc', 'X-XSRF-TOKEN': 'xyz' };

  it('stores exchanged values under a prefix no typed field can occupy', () => {
    expect(generate_exchanged_credential_values(headers)).toEqual({
      'from_the_exchange.Cookie': 'session=abc',
      'from_the_exchange.X-XSRF-TOKEN': 'xyz',
    });
  });

  it('points every generated rule at a prefixed value, on every allowed host', () => {
    const rules = generate_delivery_rules_for_exchanged_headers({
      headers,
      hosts: ['www.acmebooking.com', 'api.acmebooking.com'],
      confirmed_time: new Date('2026-07-31T12:00:00.000Z'),
    });

    expect(rules).toHaveLength(4);
    expect(rules.every((rule) => rule.take_the_value_from.startsWith('from_the_exchange.'))).toBe(
      true,
    );
    expect(rules[0]).toMatchObject({
      when_the_request_goes_to: 'www.acmebooking.com',
      put_it_in_header: 'Cookie',
      take_the_value_from: 'from_the_exchange.Cookie',
      worked_out_by: 'login',
      last_confirmed_time: '2026-07-31T12:00:00.000Z',
    });
  });

  it('drops the previous exchange rules but keeps the ones a human wrote', () => {
    const previous = generate_delivery_rules_for_exchanged_headers({
      headers,
      hosts: ['www.acmebooking.com'],
      confirmed_time: new Date('2026-07-30T12:00:00.000Z'),
    });
    const human_written = parse_app_config({
      add_to_every_request: [
        {
          when_the_request_goes_to: 'www.acmebooking.com',
          take_the_value_from: 'api_key',
          put_it_in_header: 'X-API-Key',
          worked_out_by: 'human_override',
        },
      ],
    }).add_to_every_request;

    expect(drop_rules_from_a_previous_exchange([...previous, ...human_written])).toEqual(
      human_written,
    );
  });
});

describe('app_config', () => {
  it('carries the recipe beside the rules, in the column that already exists', () => {
    const config = parse_app_config({ exchange_the_credential_by: method });

    expect(config.exchange_the_credential_by?.exchange_kind).toBe('api_login');
    expect(config.add_to_every_request).toEqual([]);
  });
});
