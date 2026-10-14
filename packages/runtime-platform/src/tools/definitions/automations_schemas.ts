import { z } from 'zod';

const automation_rule_schema = z.strictObject({
  field: z
    .string()
    .min(1)
    .describe('Dot path into the event fields, for example sender or payload.headers.Subject.'),
  operation: z.enum([
    'equals_any_of',
    'is_not_any_of',
    'contains_any_of',
    'does_not_contain_any_of',
    'is_present',
    'is_absent',
  ]),
  values: z
    .array(z.string().min(1))
    .optional()
    .describe('Compared case-insensitively and trimmed. Omit for is_present and is_absent.'),
});

const automation_trigger_schema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('schedule'),
    cron: z.string().min(1).describe('Five-field cron expression, for example 0 8 * * 1-5.'),
    timezone: z
      .string()
      .min(1)
      .optional()
      .describe('IANA timezone. Only set it when the user named a place. Never guess UTC.'),
  }),
  z.strictObject({
    kind: z.literal('app_event'),
    node_key: z.string().min(1).describe('Trigger type from list_trigger_types.'),
    connection_id: z
      .string()
      .min(1)
      .optional()
      .describe('Connection to watch. Omit to use the active connection for that app.'),
    subscription_config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Provider settings from setup_fields, for example { labelIds: "INBOX" }.'),
    conditions: z
      .array(automation_rule_schema)
      .optional()
      .describe('Every rule must pass or the event is dropped before anything else reads it.'),
  }),
  z.strictObject({
    kind: z.literal('manual'),
  }),
  z.strictObject({
    kind: z.literal('webhook'),
  }),
]);

const sends_without_asking_field = z
  .boolean()
  .optional()
  .describe(
    'true only when the person asked, in their own words, for this automation to send on its own without asking first. Off by default: everything outbound is proposed first.',
  );

export const create_automation_input_schema = z.strictObject({
  name: z.string().min(1).max(160).describe('Short automation name shown in the automations list.'),
  instruction: z
    .string()
    .min(1)
    .describe(
      'What to DO every time this automation starts, written as if the run knows nothing about this conversation. Say that everything outbound is proposed to the person first; telling the person themselves is never outbound.',
    ),
  triggers: z
    .array(automation_trigger_schema)
    .min(1)
    .describe(
      'Every way this automation can start. One automation, one instruction, many triggers.',
    ),
  rules: z
    .array(automation_rule_schema)
    .optional()
    .describe('Conditions for events on subjects we have never seen. All must pass.'),
  judge_question: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe(
      'One yes/no question about a single event, asked only for subjects with no conversation yet, for example "Is this a customer asking about an invoice?".',
    ),
  run_at_or_above: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Judge confidence 0-100 needed to run. Omit for the workspace setting.'),
  sends_without_asking: sends_without_asking_field,
  mined_from_notification_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The idea id, when this chat started from an idea on the Ideas page that named one. Pass it through unchanged.',
    ),
});

export const list_automations_input_schema = z.strictObject({
  include_paused: z
    .boolean()
    .default(true)
    .describe('Include paused automations. Defaults to true.'),
});

export const edit_automation_input_schema = z
  .strictObject({
    automation_id: z.string().min(1).describe('Automation id.'),
    name: z.string().min(1).max(160).optional().describe('New automation name.'),
    instruction: z.string().min(1).optional().describe('New instruction for future runs.'),
    rules: z
      .array(automation_rule_schema)
      .optional()
      .describe('Replaces the automation conditions.'),
    triggers: z
      .array(automation_trigger_schema)
      .min(1)
      .optional()
      .describe(
        'Replaces every way this automation starts. Triggers that match one already there keep running untouched.',
      ),
    judge_question: z
      .string()
      .min(1)
      .max(500)
      .nullable()
      .optional()
      .describe('Replaces the judge question. null removes the judge, so every event runs.'),
    run_at_or_above: z.number().min(0).max(100).optional().describe('New judge confidence.'),
    sends_without_asking: sends_without_asking_field,
  })
  .superRefine((value, ctx) => {
    const { automation_id: _id, ...fields } = value;
    if (Object.values(fields).every((field) => field === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one automation field to edit.' });
    }
  });

export const set_automation_status_input_schema = z.strictObject({
  automation_id: z.string().min(1).describe('Automation id.'),
  status: z
    .enum(['enabled', 'paused'])
    .describe('Pausing stops every trigger and keeps the automation saved.'),
});

export const automation_id_input_schema = z.strictObject({
  automation_id: z.string().min(1).describe('Automation id.'),
});

export const automation_trigger_summary_schema = z.strictObject({
  trigger_id: z.string(),
  kind: z.string(),
  status: z.string(),
  cron: z.string().nullable(),
  node_key: z.string().nullable(),
  webhook_url: z.string().nullable().optional(),
  webhook_url_note: z.string().nullable().optional(),
  webhook_secret: z.string().nullable().optional(),
  problem: z.string().nullable(),
});

export const automation_summary_schema = z.strictObject({
  automation_id: z.string(),
  name: z.string(),
  status: z.string(),
  instruction: z.string(),
  subject_from: z.string().nullable(),
  sends_without_asking: z.boolean(),
  created_via: z.string(),
  triggers: z.array(automation_trigger_summary_schema),
});

export const automation_output_schema = z.strictObject({
  automation: automation_summary_schema,
  readback: z.string(),
});

export const automation_list_output_schema = z.strictObject({
  count: z.number(),
  automations: z.array(automation_summary_schema),
});

export const delete_automation_output_schema = z.strictObject({
  automation_id: z.string(),
  deleted: z.boolean(),
});

export const run_now_output_schema = z.strictObject({
  automation_id: z.string(),
  started: z.boolean(),
  event_id: z.string().nullable(),
});
