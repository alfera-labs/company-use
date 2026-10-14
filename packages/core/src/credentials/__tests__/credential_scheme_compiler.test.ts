import {
  compile_security_scheme,
  compile_security_schemes,
  normalize_security_scheme,
  type SecurityScheme,
} from '@coworker/core/credentials/credential_scheme_compiler';
import { describe, expect, it } from 'vitest';

const host = 'api.example.com';

function compile(scheme: SecurityScheme) {
  return compile_security_scheme({ scheme, host });
}

describe('compile_security_scheme', () => {
  it.each<[SecurityScheme, unknown]>([
    [
      { type: 'apiKey', in: 'header', name: 'X-Key' },
      { kind: 'rule', rule: { put_it_in_header: 'X-Key', written_as: '{value}' } },
    ],
    [
      { type: 'apiKey', in: 'cookie', name: 'session' },
      { kind: 'rule', rule: { put_it_in_header: 'Cookie', written_as: 'session={value}' } },
    ],
    [
      { type: 'apiKey', in: 'query', name: 'api_key' },
      { kind: 'rule', rule: { put_it_in_the_query_at: 'api_key' } },
    ],
    [
      { type: 'http', scheme: 'bearer' },
      { kind: 'rule', rule: { put_it_in_header: 'Authorization', written_as: 'Bearer {value}' } },
    ],
    [
      { type: 'http', scheme: 'basic' },
      {
        kind: 'rule',
        rule: {
          take_the_value_from: 'password',
          encode_the_value_as: 'basic_auth',
          written_as: 'Basic {value}',
        },
      },
    ],
  ])('compiles %#', (scheme, expected) => {
    expect(compile(scheme)).toMatchObject(expected as object);
  });

  it('normalises a Swagger 2 basic scheme before compiling', () => {
    const normalised = normalize_security_scheme({ type: 'basic' });
    expect(normalised).toEqual({ type: 'http', scheme: 'basic' });
    expect(compile(normalised as SecurityScheme)).toMatchObject({
      kind: 'rule',
      rule: { encode_the_value_as: 'basic_auth', written_as: 'Basic {value}' },
    });
  });

  it('rejects a scheme type it cannot normalise', () => {
    expect(normalize_security_scheme({ type: 'mutualTLS' })).toBeNull();
    expect(normalize_security_scheme('nonsense')).toBeNull();
  });

  it('compiles oauth2 from the first declared flow', () => {
    const result = compile({
      type: 'oauth2',
      flows: {
        clientCredentials: { tokenUrl: 'https://example.com/oauth/token', scopes: {} },
      },
    });
    expect(result).toMatchObject({
      kind: 'needs_token_first',
      auth_method_key: 'oauth2_clientCredentials',
    });
    expect(result.kind === 'needs_token_first' && result.resulting_rule).toMatchObject({
      take_the_value_from: 'access_token',
      written_as: 'Bearer {value}',
    });
  });

  it('compiles OpenID Connect to an authorization-code Bearer rule', () => {
    const result = compile({
      type: 'openIdConnect',
      openIdConnectUrl: 'https://example.com/.well-known/openid-configuration',
    });
    expect(result).toMatchObject({
      kind: 'needs_token_first',
      auth_method_key: 'oauth2_authorization_code',
    });
    expect(result.kind === 'needs_token_first' && result.resulting_rule).toMatchObject({
      take_the_value_from: 'access_token',
      written_as: 'Bearer {value}',
    });
  });

  it('reports an unsupported http scheme', () => {
    expect(compile({ type: 'http', scheme: 'digest' })).toEqual({
      kind: 'unsupported',
      reason: 'http scheme "digest"',
    });
  });

  it('reports an unsupported apiKey placement', () => {
    expect(compile({ type: 'apiKey', in: 'body', name: 'key' })).toEqual({
      kind: 'unsupported',
      reason: 'apiKey placement "body"',
    });
  });

  // A specification fetched from the internet is untrusted JSON and can carry a
  // type the OpenAPI 3.0 union does not contain — mutualTLS was added in 3.1, and
  // a vendor can simply be wrong. The cast here mirrors that boundary; the
  // `default` branch is what a typed caller can never reach but real data can.
  it('reports a scheme type outside the specification union', () => {
    const from_the_wild = { type: 'mutualTLS' } as unknown as SecurityScheme;
    expect(compile(from_the_wild)).toMatchObject({ kind: 'unsupported' });
  });

  it('marks every compiled rule as worked out from the OpenAPI specification', () => {
    const compiled = compile_security_schemes({
      host,
      schemes: {
        header: { type: 'apiKey', in: 'header', name: 'X-Key' },
        bearer: { type: 'http', scheme: 'bearer' },
        oauth: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://example.com/oauth/authorize',
              tokenUrl: 'https://example.com/oauth/token',
              scopes: {},
            },
          },
        },
        open_id: {
          type: 'openIdConnect',
          openIdConnectUrl: 'https://example.com/.well-known/openid-configuration',
        },
      },
    });
    const rules = compiled.flatMap((result) =>
      result.kind === 'rule'
        ? [result.rule]
        : result.kind === 'needs_token_first'
          ? [result.resulting_rule]
          : [],
    );
    expect(rules.every((rule) => rule.worked_out_by === 'openapi_spec')).toBe(true);
  });
});
