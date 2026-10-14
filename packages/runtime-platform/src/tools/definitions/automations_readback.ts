import type { Database } from '@coworker/core';
import type { Automation } from '@coworker/core/db/queries/automation_reads';
import { get_tool_catalog_entry } from '@coworker/core/db/queries/catalog';
import type { RuntimeToolResult } from '@coworker/shared';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { automation_output_schema } from '@runtime-platform/tools/definitions/automations_schemas';
import {
  read_trigger_problem,
  summarize_automation,
  webhook_url_for,
} from '@runtime-platform/tools/definitions/automations_support';
import { format_trigger_display_name } from '@runtime-platform/tools/trigger_display_name';
import type { TriggerRowWithNewSecret } from '@runtime-platform/triggers/trigger_webhook_secret';

const weekday_names = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export async function automation_result(
  db: Database,
  automation: Automation,
  triggers: TriggerRowWithNewSecret[],
): Promise<RuntimeToolResult> {
  const app_event_names = await read_app_event_names(db, automation.workspace_id, triggers);
  return {
    success: true,
    data: automation_output_schema.parse({
      automation: summarize_automation(automation, triggers),
      readback: build_readback(automation, triggers, app_event_names),
    }),
  };
}

function build_readback(
  automation: Automation,
  triggers: TriggerRow[],
  app_event_names: Map<string, string>,
) {
  const when =
    triggers.map((trigger) => describe_trigger_timing(trigger, app_event_names)).join(' or ') ||
    'only when you run it';
  const problems = triggers.flatMap((trigger) => {
    const problem = read_trigger_problem(trigger);
    return problem ? [problem] : [];
  });
  return [
    `When: ${when}.`,
    `Then: ${automation.instruction}`,
    'Tell you: per your attention settings.',
    ...(problems.length > 0 ? [`Not listening yet: ${problems.join('; ')}.`] : []),
  ].join('\n');
}

async function read_app_event_names(db: Database, workspace_id: string, triggers: TriggerRow[]) {
  const node_keys = triggers.flatMap((trigger) => {
    const node_key = trigger.trigger_config?.event_source?.node_key;
    return node_key ? [node_key] : [];
  });
  const names = new Map<string, string>();
  for (const node_key of new Set(node_keys)) {
    const node = await get_tool_catalog_entry(db, { workspace_id, node_key });
    if (!node) continue;
    const name = format_trigger_display_name(node.node_display_name, node.app_display_name);
    names.set(node_key, `"${name}" in ${node.app_display_name}`);
  }
  return names;
}

function describe_trigger_timing(trigger: TriggerRow, app_event_names: Map<string, string>) {
  if (trigger.trigger_type === 'schedule') {
    const timezone = trigger.trigger_config?.timezone;
    const schedule = describe_schedule(trigger.schedule_expression ?? '');
    return `${schedule}${timezone ? ` (${timezone})` : ''}`;
  }
  if (trigger.trigger_type === 'manual') return 'when you run it';
  if (trigger.trigger_type === 'webhook')
    return `when anything POSTs to ${webhook_url_for(trigger)}`;
  const node_key = trigger.trigger_config?.event_source?.node_key;
  return `on ${(node_key && app_event_names.get(node_key)) ?? 'an app event'}`;
}

export function describe_schedule(cron: string) {
  const [minute = '', hour = '', day_of_month, month, day_of_week = ''] = cron.trim().split(/\s+/);
  const fallback = `on the schedule ${cron.trim()}`;
  if (!/^\d+$/.test(minute) || day_of_month !== '*' || month !== '*') return fallback;
  if (hour === '*' && day_of_week === '*') return `every hour at :${minute.padStart(2, '0')}`;
  if (!/^\d+$/.test(hour)) return fallback;
  const days = describe_weekdays(day_of_week);
  if (!days) return fallback;
  return `${days} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function describe_weekdays(field: string) {
  if (field === '*') return 'every day';
  if (field === '1-5') return 'every weekday';
  if (!/^[0-7](,[0-7])*$/.test(field)) return null;
  return `every ${field
    .split(',')
    .map((day) => weekday_names[Number(day) % 7])
    .join(', ')}`;
}
