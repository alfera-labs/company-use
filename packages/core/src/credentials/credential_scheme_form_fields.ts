import type { SecurityScheme } from '@coworker/core/credentials/credential_scheme_compiler';

type CredentialFormField = {
  field_name: string;
  label: string;
  is_secret: boolean;
  prefilled_value?: string | undefined;
};

export type CredentialForm = {
  standard: string;
  fields: readonly CredentialFormField[];
};

const secret_field = (field_name: string, label: string): CredentialFormField => ({
  field_name,
  label,
  is_secret: true,
});

const prefilled_field = (
  field_name: string,
  label: string,
  prefilled_value: string,
): CredentialFormField => ({ field_name, label, is_secret: false, prefilled_value });

function build_http_form(scheme: Extract<SecurityScheme, { type: 'http' }>): CredentialForm {
  const http_scheme = scheme.scheme.toLowerCase();
  if (http_scheme === 'basic') {
    return {
      standard: 'RFC 7617 (HTTP Basic)',
      fields: [secret_field('username', 'Username'), secret_field('password', 'Password')],
    };
  }
  if (http_scheme === 'bearer') {
    const label = scheme.bearerFormat ? `Token (${scheme.bearerFormat})` : 'Token';
    return { standard: 'RFC 6750 (Bearer token)', fields: [secret_field('token', label)] };
  }
  return { standard: `HTTP "${scheme.scheme}"`, fields: [] };
}

function build_oauth2_form(scheme: Extract<SecurityScheme, { type: 'oauth2' }>): CredentialForm {
  const [flow_name, flow] = Object.entries(scheme.flows ?? {})[0] ?? [];
  const fields: CredentialFormField[] = [
    secret_field('client_id', 'Client ID'),
    secret_field('client_secret', 'Client secret'),
  ];
  if (flow && 'authorizationUrl' in flow && typeof flow.authorizationUrl === 'string') {
    fields.push(prefilled_field('authorize_url', 'Authorize URL', flow.authorizationUrl));
  }
  if (flow && 'tokenUrl' in flow && typeof flow.tokenUrl === 'string') {
    fields.push(prefilled_field('token_url', 'Token URL', flow.tokenUrl));
  }
  if (flow?.scopes) {
    const count = Object.keys(flow.scopes).length;
    fields.push(prefilled_field('scopes', 'Scopes', `${count} offered by this API`));
  }
  return { standard: `RFC 6749 (OAuth 2.0, ${flow_name ?? 'unknown flow'})`, fields };
}

export function build_credential_form(scheme: SecurityScheme): CredentialForm {
  switch (scheme.type) {
    case 'apiKey':
      return {
        standard: 'OpenAPI Security Scheme Object',
        fields: [
          secret_field('credential', 'API key'),
          prefilled_field('sent_as', 'Sent as', `${scheme.in}: ${scheme.name}`),
        ],
      };
    case 'http':
      return build_http_form(scheme);
    case 'oauth2':
      return build_oauth2_form(scheme);
    case 'openIdConnect':
      return {
        standard: 'OpenID Connect Discovery',
        fields: [
          secret_field('client_id', 'Client ID'),
          secret_field('client_secret', 'Client secret'),
          prefilled_field(
            'discovery_url',
            'Everything else',
            `discovered from ${scheme.openIdConnectUrl}`,
          ),
        ],
      };
    default: {
      const unhandled: never = scheme;
      throw new Error(`unsupported_security_scheme:${JSON.stringify(unhandled)}`);
    }
  }
}
