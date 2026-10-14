import type { AppCredentialRule } from '@coworker/core/credentials/app_credential_config';
import type { OpenAPIV3 } from 'openapi-types';

export type SecurityScheme = OpenAPIV3.SecuritySchemeObject;

export type CompiledScheme =
  | { kind: 'rule'; rule: AppCredentialRule }
  | { kind: 'needs_token_first'; auth_method_key: string; resulting_rule: AppCredentialRule }
  | { kind: 'unsupported'; reason: string };

type CompileInput = {
  scheme: SecurityScheme;
  host: string;
  take_the_value_from?: string | undefined;
};

function create_rule(
  input: CompileInput,
  parts: Omit<Partial<AppCredentialRule>, 'when_the_request_goes_to' | 'worked_out_by'>,
): AppCredentialRule {
  return {
    when_the_request_goes_to: input.host,
    take_the_value_from: input.take_the_value_from ?? 'credential',
    encode_the_value_as: 'as_is',
    written_as: '{value}',
    worked_out_by: 'openapi_spec',
    ...parts,
  } as AppCredentialRule;
}

function create_bearer_rule(input: CompileInput, take_the_value_from: string): AppCredentialRule {
  return create_rule(
    { ...input, take_the_value_from },
    { put_it_in_header: 'Authorization', written_as: 'Bearer {value}' },
  );
}

// The spec types `in` as a plain string, so an unknown placement is reachable.
function compile_api_key(
  input: CompileInput,
  scheme: OpenAPIV3.ApiKeySecurityScheme,
): CompiledScheme {
  if (scheme.in === 'header') {
    return { kind: 'rule', rule: create_rule(input, { put_it_in_header: scheme.name }) };
  }
  if (scheme.in === 'cookie') {
    return {
      kind: 'rule',
      rule: create_rule(input, {
        put_it_in_header: 'Cookie',
        written_as: `${scheme.name}={value}`,
      }),
    };
  }
  if (scheme.in === 'query') {
    return { kind: 'rule', rule: create_rule(input, { put_it_in_the_query_at: scheme.name }) };
  }
  return { kind: 'unsupported', reason: `apiKey placement "${scheme.in}"` };
}

function compile_http(input: CompileInput, scheme: OpenAPIV3.HttpSecurityScheme): CompiledScheme {
  const http_scheme = scheme.scheme.toLowerCase();
  if (http_scheme === 'bearer') {
    return { kind: 'rule', rule: create_bearer_rule(input, input.take_the_value_from ?? 'token') };
  }
  if (http_scheme === 'basic') {
    return {
      kind: 'rule',
      rule: create_rule(
        { ...input, take_the_value_from: 'password' },
        {
          encode_the_value_as: 'basic_auth',
          put_it_in_header: 'Authorization',
          written_as: 'Basic {value}',
        },
      ),
    };
  }
  return { kind: 'unsupported', reason: `http scheme "${scheme.scheme}"` };
}

// A fetched specification is untrusted JSON, and plenty of live APIs are still
// Swagger 2, which spells HTTP Basic as `{ type: 'basic' }` and has no `http`
// type at all. Normalise at the boundary so everything below sees the OpenAPI 3
// union and the switch can stay exhaustive.
export function normalize_security_scheme(scheme: unknown): SecurityScheme | null {
  if (typeof scheme !== 'object' || scheme === null) return null;
  const type = (scheme as { type?: unknown }).type;
  if (type === 'basic') return { type: 'http', scheme: 'basic' };
  if (type === 'apiKey' || type === 'http' || type === 'oauth2' || type === 'openIdConnect') {
    return scheme as SecurityScheme;
  }
  return null;
}

export function compile_security_scheme(input: CompileInput): CompiledScheme {
  const { scheme } = input;
  switch (scheme.type) {
    case 'apiKey':
      return compile_api_key(input, scheme);
    case 'http':
      return compile_http(input, scheme);
    case 'oauth2': {
      const flow_name = Object.keys(scheme.flows ?? {})[0];
      if (!flow_name) return { kind: 'unsupported', reason: 'oauth2 scheme declares no flows' };
      return {
        kind: 'needs_token_first',
        auth_method_key: `oauth2_${flow_name}`,
        resulting_rule: create_bearer_rule(input, 'access_token'),
      };
    }
    case 'openIdConnect':
      return {
        kind: 'needs_token_first',
        auth_method_key: 'oauth2_authorization_code',
        resulting_rule: create_bearer_rule(input, 'access_token'),
      };
    default: {
      const unhandled: never = scheme;
      return { kind: 'unsupported', reason: `unknown scheme ${JSON.stringify(unhandled)}` };
    }
  }
}

export function compile_security_schemes(input: {
  schemes: Readonly<Record<string, SecurityScheme>>;
  host: string;
}): readonly CompiledScheme[] {
  return Object.values(input.schemes).map((scheme) =>
    compile_security_scheme({ scheme, host: input.host }),
  );
}
