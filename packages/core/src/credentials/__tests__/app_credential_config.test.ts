import {
  type AppCredentialRule,
  parse_app_config,
} from '@coworker/core/credentials/app_credential_config';
import { render_credential_value } from '@coworker/core/credentials/credential_value_renderer';
import { describe, expect, it } from 'vitest';

const rule_inputs = {
  when_the_request_goes_to: 'api.example.com',
  take_the_value_from: 'token',
  worked_out_by: 'openapi_spec',
} as const;

function parse_rule(overrides: Record<string, unknown>): AppCredentialRule {
  return parse_app_config({
    add_to_every_request: [{ ...rule_inputs, ...overrides }],
  }).add_to_every_request[0] as AppCredentialRule;
}

describe('parse_app_config', () => {
  it('defaults an empty app config to no delivery rules and no protocol headers', () => {
    expect(parse_app_config({})).toEqual({ add_to_every_request: [], api_protocol_headers: {} });
  });

  it('rejects a rule with both header and body placements', () => {
    expect(() =>
      parse_rule({
        put_it_in_header: 'authorization',
        put_it_in_the_body_at: 'token',
        the_body_is: 'json',
      }),
    ).toThrow('a rule must say exactly one place the value goes');
  });

  it('rejects a rule without a placement', () => {
    expect(() => parse_rule({})).toThrow('a rule must say exactly one place the value goes');
  });

  it('rejects a body rule without a body format', () => {
    expect(() => parse_rule({ put_it_in_the_body_at: 'token' })).toThrow(
      'a body rule must say whether the body is json, xml or form',
    );
  });

  it('rejects an unknown encoding by name', () => {
    expect(() =>
      parse_rule({ put_it_in_header: 'authorization', encode_the_value_as: 'nonsense' }),
    ).toThrow('unknown encoding: nonsense');
  });

  it('rejects an unknown extra key', () => {
    expect(() => parse_rule({ put_it_in_header: 'authorization', unexpected_key: true })).toThrow(
      'Unrecognized key',
    );
  });

  it('parses a bearer rule with value defaults', () => {
    expect(parse_rule({ put_it_in_header: 'authorization' })).toMatchObject({
      encode_the_value_as: 'as_is',
      written_as: '{value}',
    });
  });
});

describe('render_credential_value', () => {
  it('renders a bearer value', () => {
    const rule = parse_rule({ put_it_in_header: 'authorization', written_as: 'Bearer {value}' });
    expect(render_credential_value({ rule, field_values: { token: 'secret' } })).toBe(
      'Bearer secret',
    );
  });

  it('renders a basic authentication value', () => {
    const rule = parse_rule({
      put_it_in_header: 'authorization',
      encode_the_value_as: 'basic_auth',
    });
    expect(
      render_credential_value({
        rule,
        field_values: { token: 'pass', username: 'user' },
      }),
    ).toBe(Buffer.from('user:pass').toString('base64'));
  });

  it('rejects a missing credential field', () => {
    const rule = parse_rule({ put_it_in_header: 'authorization' });
    expect(() => render_credential_value({ rule, field_values: {} })).toThrow(
      'credential_field_missing:token',
    );
  });
});
