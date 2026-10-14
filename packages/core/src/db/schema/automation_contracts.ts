import { z } from 'zod';

export const trigger_rule_operations = [
  'equals_any_of',
  'is_not_any_of',
  'contains_any_of',
  'does_not_contain_any_of',
  'is_present',
  'is_absent',
  'address_is_any_of',
  'address_is_not_any_of',
  'header_present',
  'header_missing',
] as const;

export const automation_trigger_rule_schema = z.strictObject({
  field: z.string().min(1),
  operation: z.enum(trigger_rule_operations),
  values: z.array(z.string()).optional(),
});

const automation_budget_schema = z.strictObject({
  max_fires_per_day: z.number().int().min(1).max(500).default(50),
  max_no_progress_runs: z.number().int().min(1).max(100).default(3),
});

export const automation_run_policy_schema = z.strictObject({
  subject_from: z.string().min(1).nullable(),
  when_a_run_is_already_going: z.enum(['wait_for_it_to_finish', 'start_another_one']),
  listen: z.boolean().optional(),
  sends_without_asking: z.boolean().optional(),
  budget: automation_budget_schema.optional(),
});

export function read_automation_budget(run_policy: { budget?: unknown } | null | undefined) {
  return automation_budget_schema.parse(run_policy?.budget ?? {});
}

export const automation_conditions_schema = z.array(automation_trigger_rule_schema);

export const automation_judge_schema = z
  .strictObject({
    question: z.string().min(1),
    run_at_or_above: z.number().min(0).max(100).optional(),
  })
  .nullable();

const automation_uses_tools_schema = z.strictObject({
  apps: z.array(z.string().min(1)),
});

export const automation_statuses = ['enabled', 'paused', 'error', 'archived'] as const;
export const automation_created_via = [
  'user',
  'agent_tool',
  'api',
  'automation_miner',
  'system',
] as const;

export const notification_urgencies = [
  'deadline',
  'expires_soon',
  'routine',
  'fyi',
  'system_problem',
] as const;

export const notification_evidence_schema = z
  .strictObject({
    event_ids: z.array(z.string().min(1)),
    brain_slugs: z.array(z.string().min(1)),
    run_ids: z.array(z.string().min(1)),
    message_refs: z.array(z.string().min(1)),
  })
  .refine(
    (evidence) => Object.values(evidence).some((references) => references.length > 0),
    'a notification needs at least one piece of evidence',
  );

export const notification_proposed_action_schema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('open_draft'), session_id: z.string().min(1) }),
  z.strictObject({ kind: z.literal('approve_held_call'), job_id: z.string().min(1) }),
  z.strictObject({ kind: z.literal('create_automation'), instruction: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('offer_to_act'),
    instruction: z.string().min(1),
    needs_apps: z.array(z.string().min(1)).default([]),
  }),
  z.strictObject({
    kind: z.literal('connect_app'),
    app_name: z.string().min(1),
    reason: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('improve_automation'),
    automation_id: z.string().min(1),
    suggestion: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('retire_automation'), automation_id: z.string().min(1) }),
]);

const asks_the_person_action_kinds = [
  'approve_held_call',
  'open_draft',
  'offer_to_act',
  'connect_app',
  'retire_automation',
] as const;

export function action_asks_the_person(kind: string | null | undefined): boolean {
  return !!kind && (asks_the_person_action_kinds as readonly string[]).includes(kind);
}

export const delivery_channels = ['chat', 'slack_dm', 'email', 'web'] as const;
export const notification_outcomes = [
  'notify_now',
  'add_to_daily_summary',
  'add_to_ideas_list',
  'drop_with_reason',
] as const;

export const notification_held_schema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('daily_cap'), limit: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal('quiet_hours') }),
  ])
  .nullable();

export const notification_follow_ups = ['summarized', 'acted', 'dismissed'] as const;

export type AutomationStatus = (typeof automation_statuses)[number];
export type AutomationCreatedVia = (typeof automation_created_via)[number];
export type AutomationRunPolicy = z.infer<typeof automation_run_policy_schema>;
export type AutomationBudget = z.infer<typeof automation_budget_schema>;
export type AutomationConditions = z.infer<typeof automation_conditions_schema>;
export type AutomationJudge = z.infer<typeof automation_judge_schema>;
export type AutomationUsesTools = z.infer<typeof automation_uses_tools_schema>;
export type NotificationUrgency = (typeof notification_urgencies)[number];
export type NotificationEvidence = z.infer<typeof notification_evidence_schema>;
export type NotificationProposedAction = z.infer<typeof notification_proposed_action_schema>;
export type DeliveryChannel = (typeof delivery_channels)[number];
export type NotificationOutcome = (typeof notification_outcomes)[number];
export type NotificationFollowUp = (typeof notification_follow_ups)[number];
export type NotificationHeld = z.infer<typeof notification_held_schema>;
