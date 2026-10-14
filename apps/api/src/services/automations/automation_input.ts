import {
  automation_conditions_schema,
  automation_created_via,
  automation_judge_schema,
  automation_run_policy_schema,
  automation_trigger_rule_schema,
} from '@coworker/core/db/schema/automation_contracts';
import { z } from 'zod';

const automation_trigger_input_schema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('schedule'),
    trigger_name: z.string().min(1).max(160).optional(),
    cron: z.string().min(1),
    timezone: z.string().min(1).optional(),
  }),
  z.strictObject({
    kind: z.literal('app_event'),
    trigger_name: z.string().min(1).max(160).optional(),
    node_key: z.string().min(1),
    connection_id: z.string().min(1).optional(),
    subscription_config: z.record(z.string(), z.unknown()).default({}),
    conditions: z.array(automation_trigger_rule_schema).default([]),
  }),
  z.strictObject({
    kind: z.literal('manual'),
    trigger_name: z.string().min(1).max(160).optional(),
  }),
  z.strictObject({
    kind: z.literal('webhook'),
    trigger_name: z.string().min(1).max(160).optional(),
  }),
]);

const trigger_gathering_schema = z.strictObject({
  participants: z.strictObject({
    project: z.array(z.string()).readonly(),
    user: z.array(z.string()).readonly(),
    agent: z.array(z.string()).readonly(),
  }),
  room_private_to: z.string().nullable(),
});

export const create_automation_input_schema = z.strictObject({
  workspace_id: z.string().min(1),
  agent_id: z.string().min(1),
  actor_id: z.string().min(1),
  automation_name: z.string().min(1).max(160),
  instruction: z.string().min(1),
  triggers: z.array(automation_trigger_input_schema).min(1),
  run_policy: automation_run_policy_schema.default({
    subject_from: null,
    when_a_run_is_already_going: 'wait_for_it_to_finish',
  }),
  conditions: automation_conditions_schema.default([]),
  judge: automation_judge_schema.default(null),
  created_via: z.enum(automation_created_via).default('user'),
  metadata: z.record(z.string(), z.unknown()).default({}),
  gathering: trigger_gathering_schema.optional(),
});

export const update_automation_input_schema = z.strictObject({
  workspace_id: z.string().min(1),
  automation_id: z.string().min(1),
  actor_id: z.string().min(1),
  automation_name: z.string().min(1).max(160).optional(),
  instruction: z.string().min(1).optional(),
  triggers: z.array(automation_trigger_input_schema).min(1).optional(),
  run_policy: automation_run_policy_schema.optional(),
  conditions: automation_conditions_schema.optional(),
  judge: automation_judge_schema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  gathering: trigger_gathering_schema.optional(),
});

export type CreateAutomationInput = z.input<typeof create_automation_input_schema>;
export type UpdateAutomationInput = z.input<typeof update_automation_input_schema>;
export type AutomationTriggerInput = z.output<typeof automation_trigger_input_schema>;
