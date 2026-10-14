import type { Database } from '@coworker/core';
import { get_automation } from '@coworker/core/db/queries/automation_reads';
import { get_tool_catalog_entry } from '@coworker/core/db/queries/catalog';
import type { AutomationRunPolicy } from '@coworker/core/db/schema/automation_contracts';
import { default_subject_field_candidates } from '@coworker/core/integrations/trigger_subject_fields';
import type { TriggerFireDelivery, TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { read_dot_path } from '@runtime-platform/triggers/trigger_rules';
import { type AnyColumn, like, or } from 'drizzle-orm';

const subject_marker = ':subject:';
const fire_marker = ':fire:';

export type AutomationFireKeys = {
  session_key: string;
  queue_key: string;
  subject_source: SubjectSource;
};

export type SubjectSource = 'automation' | 'node' | 'occurrence' | `fallback:${string}`;
export type AutomationSubject = { value: string; source: SubjectSource };

export function automation_session_key(automation_id: string, subject_value: string) {
  return `automation:${automation_id}${subject_marker}${subject_value}`;
}

export function queue_key_is_about_subject(column: AnyColumn, subject_value: string) {
  const value = subject_value.replace(/[\\%_]/g, (character) => `\\${character}`);
  const session_key = `automation:%${subject_marker}${value}`;
  return or(like(column, session_key), like(column, `${session_key}${fire_marker}%`));
}

export function read_session_key_from_queue_key(queue_key: string): string | null {
  if (!queue_key.startsWith('automation:') || !queue_key.includes(subject_marker)) return null;
  const fire_at = queue_key.indexOf(fire_marker);
  return fire_at < 0 ? queue_key : queue_key.slice(0, fire_at);
}

export function read_subject_value_from_session_key(session_key: string): string | null {
  const marker = session_key.indexOf(subject_marker);
  if (marker < 0) return null;
  return session_key.slice(marker + subject_marker.length) || null;
}

export function read_automation_subject(input: {
  run_policy: AutomationRunPolicy | null | undefined;
  node_subject_field?: string | null | undefined;
  delivery?: TriggerFireDelivery | undefined;
  occurrence_key: string;
}): AutomationSubject {
  const data = input.delivery?.data ?? {};
  const named = read_named_field(data, input.run_policy?.subject_from);
  if (named) return { value: named, source: 'automation' };
  const from_node = read_named_field(data, input.node_subject_field);
  if (from_node) return { value: from_node, source: 'node' };
  for (const field of default_subject_field_candidates) {
    const value = readable_value(read_dot_path(data, field));
    if (value) return { value, source: `fallback:${field}` };
  }
  return { value: input.occurrence_key, source: 'occurrence' };
}

export function read_automation_subject_value(
  input: Parameters<typeof read_automation_subject>[0],
) {
  return read_automation_subject(input).value;
}

function read_named_field(data: Record<string, unknown>, field: string | null | undefined) {
  return field ? readable_value(read_dot_path(data, field)) : null;
}

export function build_automation_fire_keys(input: {
  automation_id: string;
  run_policy: AutomationRunPolicy | null | undefined;
  node_subject_field?: string | null | undefined;
  delivery?: TriggerFireDelivery | undefined;
  occurrence_key: string;
}): AutomationFireKeys {
  const subject = read_automation_subject(input);
  const session_key = automation_session_key(input.automation_id, subject.value);
  const runs_alongside = input.run_policy?.when_a_run_is_already_going === 'start_another_one';
  return {
    session_key,
    queue_key: runs_alongside ? `${session_key}${fire_marker}${input.occurrence_key}` : session_key,
    subject_source: subject.source,
  };
}

export async function find_automation_fire_keys(
  db: Database,
  trigger: TriggerRow,
  options: { occurrence_key: string; delivery?: TriggerFireDelivery | undefined },
): Promise<AutomationFireKeys | null> {
  if (!trigger.automation_id) return null;
  const automation = await get_automation(db, {
    workspace_id: trigger.workspace_id,
    automation_id: trigger.automation_id,
  });
  if (!automation) return null;
  return build_automation_fire_keys({
    ...options,
    automation_id: trigger.automation_id,
    run_policy: automation.run_policy,
    node_subject_field: await read_trigger_node_subject_field(db, trigger),
  });
}

export async function read_trigger_node_subject_field(
  db: Database,
  trigger: TriggerRow,
): Promise<string | null> {
  const node_key = trigger.trigger_config?.event_source?.node_key;
  if (!node_key) return null;
  const node = await get_tool_catalog_entry(db, {
    workspace_id: trigger.workspace_id,
    node_key,
  });
  return node?.node_config.subject_field ?? null;
}

export function read_session_key_for_fire(
  queue_key: string | undefined,
  automation: { automation_id: string },
  subject: AutomationSubject,
): string {
  const from_subject = queue_key ? read_session_key_from_queue_key(queue_key) : null;
  return from_subject ?? automation_session_key(automation.automation_id, subject.value);
}

function readable_value(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}
