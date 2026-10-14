import {
  compile_security_scheme,
  type SecurityScheme,
} from '@coworker/core/credentials/credential_scheme_compiler';
import { build_credential_form } from '@coworker/core/credentials/credential_scheme_form_fields';

type CredentialTypeDefinition = {
  credential_type_key: string;
  label: string;
  scheme: SecurityScheme;
};

const credential_type_definitions: readonly CredentialTypeDefinition[] = [
  { credential_type_key: 'bearer', label: 'Bearer', scheme: { type: 'http', scheme: 'bearer' } },
  { credential_type_key: 'basic', label: 'Basic', scheme: { type: 'http', scheme: 'basic' } },
  {
    credential_type_key: 'api_key_header',
    label: 'API key (header)',
    scheme: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
  },
  {
    credential_type_key: 'api_key_query',
    label: 'API key (query parameter)',
    scheme: { type: 'apiKey', in: 'query', name: 'api_key' },
  },
  {
    credential_type_key: 'oauth2_client_credentials',
    label: 'OAuth 2.0 client credentials',
    scheme: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: '', scopes: {} } } },
  },
  {
    credential_type_key: 'oauth2_authorization_code',
    label: 'OAuth 2.0 authorization code',
    scheme: {
      type: 'oauth2',
      flows: { authorizationCode: { authorizationUrl: '', tokenUrl: '', scopes: {} } },
    },
  },
  {
    credential_type_key: 'openid_connect',
    label: 'OpenID Connect',
    scheme: { type: 'openIdConnect', openIdConnectUrl: '' },
  },
];

export function find_credential_type_scheme(
  credential_type_key: string | undefined,
): SecurityScheme | null {
  if (!credential_type_key) return null;
  return (
    credential_type_definitions.find(
      (definition) => definition.credential_type_key === credential_type_key,
    )?.scheme ?? null
  );
}

export type CredentialTypeChoice = {
  credential_type_key: string;
  label: string;
  standard: string;
  goes: string;
  fields: {
    field_name: string;
    label: string;
    is_secret: boolean;
    prefilled_value: string | null;
  }[];
};

function describe_placement(scheme: SecurityScheme): string {
  const compiled = compile_security_scheme({ scheme, host: 'api.example.com' });
  const rule = compiled.kind === 'rule' ? compiled.rule : null;
  if (compiled.kind === 'needs_token_first') {
    return `fetched from the provider, then sent as ${compiled.resulting_rule.written_as}`;
  }
  if (!rule) return 'not supported';
  if (rule.put_it_in_the_query_at) return `query parameter ${rule.put_it_in_the_query_at}`;
  if (rule.put_it_in_the_body_at) return `body field ${rule.put_it_in_the_body_at}`;
  return `header ${rule.put_it_in_header}: ${rule.written_as}`;
}

export function list_credential_type_choices(): CredentialTypeChoice[] {
  return credential_type_definitions.map((definition) => {
    const form = build_credential_form(definition.scheme);
    return {
      credential_type_key: definition.credential_type_key,
      label: definition.label,
      standard: form.standard,
      goes: describe_placement(definition.scheme),
      fields: form.fields.map((field) => ({
        field_name: field.field_name,
        label: field.label,
        is_secret: field.is_secret,
        prefilled_value: field.prefilled_value ?? null,
      })),
    };
  });
}
