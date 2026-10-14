import { apply_trigger_rules, trigger_rule_schema } from '@coworker/core/access/trigger_rules';
import { hash_tool_input_for_approval } from '@coworker/core/db/queries/event_waits';
import { z } from 'zod';

const policy_grant_scopes = ['one_time', 'task', 'time_bounded', 'perpetual'] as const;

const policy_grant_template_schema = z.strictObject({
  fields: z.array(z.string().min(1)).min(1),
  sha256: z.string().min(1),
});

const policy_grant_schema = z.strictObject({
  grant_scope: z.enum(policy_grant_scopes),
  expires_time: z.string().datetime().optional(),
  automation_id: z.string().min(1).optional(),
  subject_selector: z.array(trigger_rule_schema).optional(),
  address_domains: z.array(z.string().min(1)).optional(),
  template: policy_grant_template_schema.optional(),
  max_per_day: z.number().int().positive().optional(),
  granted_by: z.string().min(1),
  granted_time: z.string().datetime(),
});

export type PolicyGrant = z.infer<typeof policy_grant_schema>;

export type PolicyGrantCallContext = {
  now: Date;
  automation_id?: string | null;
  tool_input?: unknown;
  calls_today?: number;
};

export function read_policy_grant(metadata: unknown): PolicyGrant | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const grant = (metadata as { grant?: unknown }).grant;
  if (grant === undefined) return null;
  return policy_grant_schema.parse(grant);
}

export function build_grant_metadata(
  input: Omit<PolicyGrant, 'granted_by' | 'granted_time'> & { granted_by: string; now?: Date },
): { grant: PolicyGrant } {
  const { now, ...grant } = input;
  return {
    grant: policy_grant_schema.parse({
      ...grant,
      granted_time: (now ?? new Date()).toISOString(),
    }),
  };
}

export function grant_covers_call(grant: PolicyGrant, context: PolicyGrantCallContext): boolean {
  if (grant.expires_time && Date.parse(grant.expires_time) <= context.now.getTime()) return false;
  if (grant.automation_id && grant.automation_id !== context.automation_id) return false;
  if (grant.subject_selector && !selector_passes(grant.subject_selector, context.tool_input)) {
    return false;
  }
  if (
    grant.address_domains &&
    !call_stays_inside_domains(grant.address_domains, context.tool_input)
  ) {
    return false;
  }
  if (
    grant.template &&
    read_template_sha256(context.tool_input, grant.template.fields) !== grant.template.sha256
  ) {
    return false;
  }
  if (grant.max_per_day !== undefined && (context.calls_today ?? 0) >= grant.max_per_day) {
    return false;
  }
  return true;
}

export function read_template_sha256(
  tool_input: unknown,
  fields: readonly string[],
): string | null {
  if (!tool_input || typeof tool_input !== 'object' || Array.isArray(tool_input)) return null;
  const record = tool_input as Record<string, unknown>;
  if (fields.some((field) => !(field in record))) return null;
  return hash_tool_input_for_approval(
    Object.fromEntries(fields.map((field) => [field, record[field]])),
  );
}

function selector_passes(selector: PolicyGrant['subject_selector'], tool_input: unknown) {
  if (!selector) return true;
  if (!tool_input || typeof tool_input !== 'object' || Array.isArray(tool_input)) return false;
  return apply_trigger_rules([...selector], tool_input as Record<string, unknown>).passed;
}

function call_stays_inside_domains(domains: readonly string[], tool_input: unknown): boolean {
  const addresses = read_call_addresses(tool_input);
  if (addresses.length === 0) return false;
  return addresses.every((address) =>
    domains.some((domain) => address_is_at_domain(address, domain)),
  );
}

function address_is_at_domain(address: string, domain: string): boolean {
  const host = read_host(address.slice(address.lastIndexOf('@') + 1));
  const wanted = read_host(domain.replace(/^@/u, ''));
  return host.length > 0 && wanted.length > 0 && (host === wanted || host.endsWith(`.${wanted}`));
}

function read_host(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/u, '');
}

// The addresses are read out of the call's JSON rather than from named fields, because
// every tool names its recipients differently (`to`, `recipients`, `email`, nested arrays). It can
// only over-match — an address quoted in a body counts too — and over-matching refuses the grant,
// which asks the person instead of widening anything.
const address_pattern = /[^\s"'<>,;:\\]+@[^\s"'<>,;:\\]+/gu;

function read_call_addresses(tool_input: unknown): string[] {
  if (!tool_input || typeof tool_input !== 'object') return [];
  return JSON.stringify(tool_input)?.match(address_pattern) ?? [];
}
