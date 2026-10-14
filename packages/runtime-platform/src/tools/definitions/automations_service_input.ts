import { empty_participants } from '@coworker/core/access/may_use_resource';
import type { Automation } from '@coworker/core/db/queries/automation_reads';
import type {
  AutomationConditions,
  AutomationJudge,
} from '@coworker/core/db/schema/automation_contracts';
import type {
  create_automation_input_schema,
  edit_automation_input_schema,
} from '@runtime-platform/tools/definitions/automations_schemas';
import {
  type AutomationToolContext,
  find_subject_from,
} from '@runtime-platform/tools/definitions/automations_support';
import type { z } from 'zod';

export function edited_conditions_and_judge(
  current: { conditions: AutomationConditions; judge: AutomationJudge },
  input: z.output<typeof edit_automation_input_schema>,
): { conditions?: AutomationConditions; judge?: AutomationJudge } {
  const touches_judge = input.judge_question !== undefined || input.run_at_or_above !== undefined;
  if (input.rules === undefined && !touches_judge) return {};
  const question =
    input.judge_question === null ? null : (input.judge_question ?? current.judge?.question);
  const run_at_or_above = input.run_at_or_above ?? current.judge?.run_at_or_above;
  return {
    conditions: input.rules ?? current.conditions,
    judge: question
      ? { question, ...(run_at_or_above === undefined ? {} : { run_at_or_above }) }
      : null,
  };
}

export function service_trigger(
  trigger: z.output<typeof create_automation_input_schema>['triggers'][number],
) {
  if (trigger.kind === 'schedule') {
    return {
      kind: 'schedule' as const,
      cron: trigger.cron,
      ...(trigger.timezone === undefined ? {} : { timezone: trigger.timezone }),
    };
  }
  if (trigger.kind === 'manual') return { kind: 'manual' as const };
  if (trigger.kind === 'webhook') return { kind: 'webhook' as const };
  return {
    kind: 'app_event' as const,
    node_key: trigger.node_key,
    ...(trigger.connection_id === undefined ? {} : { connection_id: trigger.connection_id }),
    subscription_config: trigger.subscription_config ?? {},
    conditions: trigger.conditions ?? [],
  };
}

export async function edited_triggers(
  ctx: AutomationToolContext,
  run_policy: Automation['run_policy'],
  triggers: NonNullable<z.output<typeof edit_automation_input_schema>['triggers']>,
) {
  const subject_from = await find_subject_from(ctx.db, {
    workspace_id: ctx.workspace_id,
    node_keys: triggers.flatMap((trigger) =>
      trigger.kind === 'app_event' ? [trigger.node_key] : [],
    ),
  });
  return {
    triggers: triggers.map(service_trigger),
    run_policy: { ...run_policy, subject_from },
    gathering: run_gathering(ctx),
  };
}

export function new_run_policy(subject_from: string | null, sends_without_asking?: boolean) {
  return {
    subject_from,
    when_a_run_is_already_going: 'wait_for_it_to_finish' as const,
    ...(sends_without_asking ? { sends_without_asking: true } : {}),
  };
}

/** An edit's triggers and run policy, keeping every policy field the edit did not name. */
export async function edited_triggers_and_policy(
  ctx: AutomationToolContext,
  run_policy: Automation['run_policy'],
  input: Pick<z.output<typeof edit_automation_input_schema>, 'triggers' | 'sends_without_asking'>,
) {
  const trigger_edit: Partial<Awaited<ReturnType<typeof edited_triggers>>> = input.triggers
    ? await edited_triggers(ctx, run_policy, input.triggers)
    : {};
  if (input.sends_without_asking === undefined) return trigger_edit;
  const sends_without_asking = input.sends_without_asking;
  return {
    ...trigger_edit,
    run_policy: { ...(trigger_edit.run_policy ?? run_policy), sends_without_asking },
  };
}

export function run_gathering(ctx: AutomationToolContext) {
  return {
    participants: ctx.participants ?? empty_participants,
    room_private_to: ctx.room_private_to ?? null,
  };
}
