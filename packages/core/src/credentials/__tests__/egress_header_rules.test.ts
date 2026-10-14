import { credential_delivery_rule_schema } from '@coworker/core/credentials/app_credential_config';
import {
  type CredentialToDeliver,
  plan_egress_headers,
} from '@coworker/core/credentials/egress_header_rules';
import { describe, expect, it } from 'vitest';

function create_rule(overrides: Record<string, unknown>) {
  return credential_delivery_rule_schema.parse({
    when_the_request_goes_to: 'www.acmebooking.com',
    take_the_value_from: 'from_the_exchange.Cookie',
    put_it_in_header: 'Cookie',
    worked_out_by: 'login',
    ...overrides,
  });
}

function create_credential(
  rules: readonly ReturnType<typeof create_rule>[],
  field_values: Record<string, string> = { 'from_the_exchange.Cookie': 'session=abc' },
): CredentialToDeliver {
  return { connection_name: 'Acme Planner', rules, field_values };
}

describe('plan_egress_headers', () => {
  it('renders the value into the header the rule names', () => {
    const plan = plan_egress_headers([
      create_credential(
        [create_rule({ take_the_value_from: 'api_key', put_it_in_header: 'Authorization' })],
        { api_key: 'k_123' },
      ),
    ]);

    expect(plan.headers_by_host).toEqual({ 'www.acmebooking.com': { Authorization: 'k_123' } });
  });

  it('merges two credentials that both target the same host', () => {
    const plan = plan_egress_headers([
      create_credential([create_rule({})]),
      {
        connection_name: 'Version header',
        rules: [
          create_rule({
            take_the_value_from: 'from_the_exchange.X-Vendor-API-Version',
            put_it_in_header: 'X-Vendor-API-Version',
          }),
        ],
        field_values: { 'from_the_exchange.X-Vendor-API-Version': '2019-06-10' },
      },
    ]);

    expect(plan.headers_by_host['www.acmebooking.com']).toEqual({
      Cookie: 'session=abc',
      'X-Vendor-API-Version': '2019-06-10',
    });
  });

  it('refuses a value that belongs in the request body', () => {
    const plan = plan_egress_headers([
      create_credential([
        create_rule({
          put_it_in_header: undefined,
          put_it_in_the_body_at: 'auth.token',
          the_body_is: 'json',
        }),
      ]),
    ]);

    expect(plan.headers_by_host).toEqual({});
    expect(plan.could_not_be_attached[0]?.because).toContain('request body');
  });

  it('refuses a value that belongs in the query string', () => {
    const plan = plan_egress_headers([
      create_credential([
        create_rule({ put_it_in_header: undefined, put_it_in_the_query_at: 'api_key' }),
      ]),
    ]);

    expect(plan.headers_by_host).toEqual({});
    expect(plan.could_not_be_attached[0]?.because).toContain('query string');
  });

  it('refuses a rule limited to one path', () => {
    const plan = plan_egress_headers([
      create_credential([create_rule({ and_the_path_starts_with: '/api/v2' })]),
    ]);

    expect(plan.headers_by_host).toEqual({});
    expect(plan.could_not_be_attached[0]?.because).toContain('host alone');
  });

  it('refuses a value calculated from the request itself', () => {
    const plan = plan_egress_headers([
      create_credential(
        [create_rule({ take_the_value_from: 'signing_key', encode_the_value_as: 'hmac_sha256' })],
        { signing_key: 'k_123' },
      ),
    ]);

    expect(plan.headers_by_host).toEqual({});
    expect(plan.could_not_be_attached[0]?.because).toContain('calculated from the request');
  });

  it('refuses a rule whose value the connection does not hold', () => {
    const plan = plan_egress_headers([
      create_credential([create_rule({ take_the_value_from: 'never_stored' })], {}),
    ]);

    expect(plan.headers_by_host).toEqual({});
    expect(plan.could_not_be_attached[0]?.because).toContain('never_stored');
  });

  it('keeps the first of two connections claiming the same header, and says so', () => {
    const plan = plan_egress_headers([
      create_credential([create_rule({})], { 'from_the_exchange.Cookie': 'first=1' }),
      create_credential([create_rule({})], { 'from_the_exchange.Cookie': 'second=2' }),
    ]);

    expect(plan.headers_by_host['www.acmebooking.com']).toEqual({ Cookie: 'first=1' });
    expect(plan.could_not_be_attached[0]?.because).toContain('already attaches Cookie');
  });

  it('still attaches the rules it can when one of them is unserviceable', () => {
    const plan = plan_egress_headers([
      create_credential([
        create_rule({ and_the_path_starts_with: '/api' }),
        create_rule({ put_it_in_header: 'X-Session' }),
      ]),
    ]);

    expect(plan.headers_by_host['www.acmebooking.com']).toEqual({ 'X-Session': 'session=abc' });
    expect(plan.could_not_be_attached).toHaveLength(1);
  });

  it('leaves a host out entirely when every rule for it was refused', () => {
    const plan = plan_egress_headers([
      create_credential([create_rule({ and_the_path_starts_with: '/api' })]),
    ]);

    expect(Object.keys(plan.headers_by_host)).toEqual([]);
  });

  it('applies the encoding and the template the rule asks for', () => {
    const plan = plan_egress_headers([
      create_credential(
        [
          create_rule({
            take_the_value_from: 'password',
            put_it_in_header: 'Authorization',
            encode_the_value_as: 'basic_auth',
            written_as: 'Basic {value}',
          }),
        ],
        { username: 'test-account', password: 'not-a-real-password' },
      ),
    ]);

    expect(plan.headers_by_host['www.acmebooking.com']?.Authorization).toBe(
      `Basic ${Buffer.from('test-account:not-a-real-password').toString('base64')}`,
    );
  });
});
