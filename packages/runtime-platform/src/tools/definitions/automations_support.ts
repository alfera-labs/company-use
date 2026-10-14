import { type Database, has_scheduled_task_run_authority } from '@coworker/core';
import { type Automation, get_automation } from '@coworker/core/db/queries/automation_reads';
import { get_tool_catalog_entry } from '@coworker/core/db/queries/catalog';
import {
  describe_automation_author,
  type JsonSchema,
  may_retire_automation,
  type RuntimeToolResult,
} from '@coworker/shared';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import {
  automation_summary_schema,
  automation_trigger_summary_schema,
} from '@runtime-platform/tools/definitions/automations_schemas';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import type { TriggerRowWithNewSecret } from '@runtime-platform/triggers/trigger_webhook_secret';
import {
  address_only_on_this_machine_note,
  read_web_call_address,
} from '@runtime-platform/triggers/web_call_address';
import { z } from 'zod';

export const agent_automation_limit = 10;

export const automations_app_name = 'automations';

const automation_context_schema = z
  .object({
    db: z.custom<RuntimeToolExecutionContext['db']>(
      (value) => value !== undefined && value !== null,
    ),
    workspace_id: z.string().min(1),
    session_id: z.string().min(1),
    run_id: z.string().min(1),
    agent_id: z.string().min(1),
    actor_id: z.string().min(1),
  })
  .passthrough();

export type AutomationToolContext = RuntimeToolExecutionContext & { agent_id: string };

export function read_automation_context(
  context: RuntimeToolExecutionContext | undefined,
  node_key: string,
): (RuntimeToolResult & { success: false }) | { success: true; data: AutomationToolContext } {
  const parsed = context ? automation_context_schema.safeParse(context) : null;
  if (!parsed?.success) {
    return tool_error('agent_context_unavailable', `${node_key} requires an agent context.`);
  }
  return { success: true, data: parsed.data as AutomationToolContext };
}

export function is_a_person_turn(ctx: AutomationToolContext) {
  return ctx.actor_id.startsWith('user_') && ctx.source_context?.source_type !== 'runtime';
}

export function read_inherited_authority(ctx: AutomationToolContext) {
  const source_metadata = ctx.source_context?.source_metadata;
  if (!has_scheduled_task_run_authority(source_metadata)) return null;
  const grantor = source_metadata?.delegated_authority?.granted_by_actor_id;
  if (!grantor?.startsWith('user_')) return null;
  const parent = source_metadata?.automation_id;
  return {
    grantor_actor_id: grantor,
    parent_automation_id: typeof parent === 'string' && parent ? parent : null,
  };
}

export function ask_the_person_error(what: string) {
  return tool_error(
    'ask_the_person',
    `An automation cannot ${what}; ask the person to do it in a chat.`,
  );
}

export const automation_filter_fields = {
  automation_id: z
    .string()
    .min(1)
    .optional()
    .describe('Only conversations an automation with this id has run in.'),
};

export function read_automation_filter(input: { automation_id?: string | undefined }) {
  return input.automation_id ? { automation_id: input.automation_id } : {};
}

export const session_filter_names = 'session_id, source, since or automation_id';

export const what_an_active_run_belongs_to = 'the automation and the conversation';

export function tool_error(code: string, message: string): RuntimeToolResult & { success: false } {
  return { success: false, error: { code, message } };
}

export function input_json_schema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as JsonSchema;
}

export function output_json_schema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }) as JsonSchema;
}

export async function find_subject_from(
  db: Database,
  input: { workspace_id: string; node_keys: string[] },
): Promise<string | null> {
  for (const node_key of input.node_keys) {
    const node = await get_tool_catalog_entry(db, { workspace_id: input.workspace_id, node_key });
    const subject_field = node?.node_config.subject_field;
    if (subject_field) return subject_field;
  }
  return null;
}

export function summarize_automation(automation: Automation, triggers: TriggerRowWithNewSecret[]) {
  return automation_summary_schema.parse({
    automation_id: automation.automation_id,
    name: automation.automation_name,
    status: automation.automation_status,
    instruction: automation.instruction,
    subject_from: automation.run_policy?.subject_from ?? null,
    sends_without_asking: automation.run_policy?.sends_without_asking === true,
    created_via: automation.created_via,
    triggers: triggers.map((trigger) =>
      automation_trigger_summary_schema.parse({
        trigger_id: trigger.trigger_id,
        kind: trigger.trigger_type,
        status: trigger.trigger_status,
        cron: trigger.schedule_expression ?? null,
        node_key: trigger.trigger_config?.event_source?.node_key ?? null,
        webhook_url: webhook_url_for(trigger),
        webhook_url_note: webhook_url_note_for(trigger),
        webhook_secret: trigger.new_webhook_secret ?? null,
        problem: read_trigger_problem(trigger),
      }),
    ),
  });
}

export function read_trigger_problem(trigger: TriggerRow): string | null {
  const needs_connection = trigger.trigger_config?.needs_connection;
  if (needs_connection) return `Waiting for ${needs_connection} to be connected`;
  return trigger.trigger_config?.provisioning_error ?? null;
}

export async function refuse_touching_somebody_elses_automation(
  ctx: AutomationToolContext,
  automation_id: string,
  what: string,
) {
  const automation = await get_automation(ctx.db, {
    workspace_id: ctx.workspace_id,
    automation_id,
  });
  if (!automation) return tool_error('not_found', `Automation ${automation_id} was not found.`);
  if (may_retire_automation(automation, ctx.actor_id)) return null;
  return tool_error(
    'ask_the_person',
    `"${automation.automation_name}" was set up by ${describe_automation_author(automation)}, so only a person can ${what} it. Write a notification with proposed_action { kind: 'improve_automation', automation_id, suggestion } and ask.`,
  );
}

export function webhook_url_for(trigger: TriggerRow): string | null {
  if (trigger.trigger_type !== 'webhook') return null;
  return read_web_call_address(trigger.trigger_id).webhook_url;
}

function webhook_url_note_for(trigger: TriggerRow): string | null {
  if (trigger.trigger_type !== 'webhook') return null;
  return read_web_call_address(trigger.trigger_id).reaches_outside_this_machine
    ? null
    : address_only_on_this_machine_note;
}
