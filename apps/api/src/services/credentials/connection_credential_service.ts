import {
  type CustomHeaderInput,
  generate_custom_header_values,
  generate_delivery_rules,
  normalize_request_host,
} from '@api/services/credentials/connect_app_request';
import type { Database } from '@coworker/core';
import type { AppCredentialRule } from '@coworker/core/credentials/app_credential_config';
import type { CredentialExchangeMethod } from '@coworker/core/credentials/credential_exchange';
import { is_blocked_host } from '@coworker/core/credentials/safe_outbound_url';
import { find_website_icon } from '@coworker/core/credentials/website_icon';
import {
  disable_workspace_credential,
  insert_workspace_credential,
  list_workspace_credentials,
} from '@coworker/core/db/queries/connection_credentials';

const masked_credential_value = '••••••••';
const credential_placement_names = [
  'put_it_in_the_query_at',
  'put_it_in_header',
  'put_it_in_the_body_at',
] as const;

type CredentialPlacementName = (typeof credential_placement_names)[number];
type CurlArgumentBuilder = (placement: string, value: string, url: URL) => string[];

const curl_argument_builders: Readonly<Record<CredentialPlacementName, CurlArgumentBuilder>> = {
  put_it_in_the_query_at: (placement, value, url) => {
    url.searchParams.set(placement, value);
    return [];
  },
  put_it_in_header: (placement, value) => [`--header '${placement}: ${value}'`],
  put_it_in_the_body_at: (placement, value) => [`--data '${placement}=${value}'`],
};

type CreateWorkspaceCredentialInput = {
  db: Database;
  workspace_id: string;
  created_by: string;
  display_name: string;
  allowed_hosts: readonly string[];
  secret_values: Readonly<Record<string, string>>;
  add_to_every_request?: readonly AppCredentialRule[] | undefined;
  credential_type_key?: string | undefined;
  custom_headers?: readonly CustomHeaderInput[] | undefined;
  exchange_the_credential_by?: CredentialExchangeMethod | undefined;
};

export function list_workspace_credentials_for_user(input: { db: Database; workspace_id: string }) {
  return list_workspace_credentials(input.db, input.workspace_id);
}

export async function create_workspace_credential_for_user(
  input: CreateWorkspaceCredentialInput,
): Promise<{ connection_id: string; app_id: string }> {
  const allowed_hosts = input.allowed_hosts.map(normalize_request_host).filter(Boolean);
  const secret_values = {
    ...input.secret_values,
    ...generate_custom_header_values(input.custom_headers ?? []),
  };
  const add_to_every_request =
    input.add_to_every_request ??
    (input.exchange_the_credential_by
      ? []
      : generate_delivery_rules({
          allowed_hosts,
          ...(input.credential_type_key ? { credential_type_key: input.credential_type_key } : {}),
          ...(input.custom_headers ? { custom_headers: input.custom_headers } : {}),
        }));

  validate_display_name(input.display_name);
  validate_allowed_hosts(allowed_hosts);
  validate_secret_values(secret_values);
  validate_rule_hosts(add_to_every_request, allowed_hosts);

  const icon_url = allowed_hosts[0] ? await find_website_icon({ host: allowed_hosts[0] }) : null;

  return insert_workspace_credential(input.db, {
    workspace_id: input.workspace_id,
    created_by: input.created_by,
    display_name: input.display_name.trim(),
    allowed_hosts,
    ...(icon_url ? { icon_url } : {}),
    secret_values,
    add_to_every_request,
    ...(input.exchange_the_credential_by
      ? { exchange_the_credential_by: input.exchange_the_credential_by }
      : {}),
  });
}

export async function disable_workspace_credential_for_user(input: {
  db: Database;
  workspace_id: string;
  connection_id: string;
}): Promise<{ disabled: true }> {
  await disable_workspace_credential(input.db, {
    workspace_id: input.workspace_id,
    connection_id: input.connection_id,
  });
  return { disabled: true };
}

function validate_display_name(display_name: string): void {
  if (!display_name.trim()) throw new Error('display_name_required');
}

function validate_allowed_hosts(allowed_hosts: readonly string[]): void {
  if (allowed_hosts.length === 0) throw new Error('allowed_hosts_required');
  for (const allowed_host of allowed_hosts) {
    // The sandbox egress allowlist accepts wildcards, but its transform rule API rejects
    // wildcard keys with a 400. Accepting one here would silently skip credential injection.
    if (allowed_host.includes('*')) throw new Error('wildcard_host_not_supported');
    if (!is_bare_hostname(allowed_host) || is_blocked_host(allowed_host)) {
      throw new Error('host_not_allowed');
    }
  }
}

function is_bare_hostname(value: string): boolean {
  if (value.length > 253 || value !== value.toLowerCase()) return false;
  const labels = value.split('.');
  if (/^[0-9]+$/.test(labels.at(-1) ?? '')) return false;
  return labels.every(
    (label) =>
      label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}

function validate_secret_values(secret_values: Readonly<Record<string, string>>): void {
  const values = Object.values(secret_values);
  if (values.length === 0 || values.some((value) => value.length === 0)) {
    throw new Error('secret_value_required');
  }
}

function validate_rule_hosts(
  rules: readonly AppCredentialRule[],
  allowed_hosts: readonly string[],
): void {
  if (rules.some((rule) => !allowed_hosts.includes(rule.when_the_request_goes_to))) {
    throw new Error('host_not_allowed');
  }
}

export function generate_resolved_curl_example(input: {
  rules: readonly AppCredentialRule[];
  allowed_hosts: readonly string[];
}): string {
  const host = input.rules[0]?.when_the_request_goes_to ?? input.allowed_hosts[0] ?? 'example.com';
  const url = new URL(`https://${host}/`);
  const lines = input.rules.flatMap((rule) => curl_rule_arguments(rule, url));
  return [`curl '${url.toString()}'`, ...lines].join(' \\\n  ');
}

function curl_rule_arguments(rule: AppCredentialRule, url: URL): string[] {
  const displayed_value = rule.written_as.replaceAll('{value}', masked_credential_value);
  const placement_name = credential_placement_names.find((name) => rule[name]);
  if (!placement_name) throw new Error('credential_rule_placement_missing');
  const placement = rule[placement_name];
  if (!placement) throw new Error('credential_rule_placement_missing');
  return curl_argument_builders[placement_name](placement, displayed_value, url);
}
