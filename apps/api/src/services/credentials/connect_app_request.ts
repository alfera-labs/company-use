import { find_credential_type_scheme } from '@api/services/credentials/credential_type_catalog';
import {
  type AppCredentialRule,
  credential_delivery_rule_schema,
} from '@coworker/core/credentials/app_credential_config';
import { compile_security_scheme } from '@coworker/core/credentials/credential_scheme_compiler';

export type CustomHeaderInput = { name: string; prefix?: string | undefined; value: string };

export function normalize_request_host(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const without_scheme = trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  const host_only = without_scheme.split(/[/?#]/)[0] ?? '';
  return host_only.split('@').pop()?.split(':')[0]?.toLowerCase() ?? '';
}

function custom_header_value_name(header_name: string): string {
  return `header_${header_name.trim().toLowerCase()}`;
}

export function generate_custom_header_values(
  custom_headers: readonly CustomHeaderInput[],
): Record<string, string> {
  return Object.fromEntries(
    custom_headers
      .filter((header) => header.name.trim() && header.value.trim())
      .map((header) => [custom_header_value_name(header.name), header.value.trim()]),
  );
}

export function generate_delivery_rules(input: {
  credential_type_key?: string | undefined;
  custom_headers?: readonly CustomHeaderInput[] | undefined;
  allowed_hosts: readonly string[];
}): AppCredentialRule[] {
  return input.allowed_hosts.flatMap((host) => [
    ...compile_chosen_credential_type(input.credential_type_key, host),
    ...(input.custom_headers ?? [])
      .filter((header) => header.name.trim() && header.value.trim())
      .map((header) => compile_custom_header(header, host)),
  ]);
}

function compile_chosen_credential_type(
  credential_type_key: string | undefined,
  host: string,
): AppCredentialRule[] {
  const scheme = find_credential_type_scheme(credential_type_key);
  if (!scheme) return [];
  const compiled = compile_security_scheme({ scheme, host });
  return compiled.kind === 'rule' ? [compiled.rule] : [];
}

function compile_custom_header(header: CustomHeaderInput, host: string): AppCredentialRule {
  const header_name = header.name.trim();
  const prefix = header.prefix?.trim() ?? '';
  return credential_delivery_rule_schema.parse({
    when_the_request_goes_to: host,
    take_the_value_from: custom_header_value_name(header_name),
    encode_the_value_as: 'as_is',
    put_it_in_header: header_name,
    written_as: prefix ? `${prefix} {value}` : '{value}',
    worked_out_by: 'human_override',
  });
}
