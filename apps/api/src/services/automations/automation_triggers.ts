import {
  automation_job_handler,
  type PlannedAutomationTrigger,
  plan_app_event_trigger,
} from '@api/services/automations/app_event_trigger_plan';
import {
  is_provider_trigger,
  refuse_provider_triggers_above_plan_limit,
} from '@api/services/automations/app_trigger_limit';
import type { AutomationTriggerInput } from '@api/services/automations/automation_input';
import { build_automation_trigger_source } from '@api/services/automations/automation_trigger_authority';
import {
  gathering_of_the_signer_alone,
  type TriggerGathering,
} from '@api/services/automations/trigger_account_choice';
import type { DatabaseExecutor } from '@coworker/core';
import type { CreateTriggerInput } from '@coworker/core/db/queries/trigger_writes';
import { read_user_timezone } from '@coworker/core/db/queries/user_timezone';
import { create_trigger_webhook_secret } from '@runtime-platform/triggers/trigger_webhook_secret';

export type AutomationTriggerOwner = {
  workspace_id: string;
  agent_id: string;
  automation_id: string;
  automation_name: string;
  instruction: string;
  actor_id: string;
  created_via: string;
  gathering?: TriggerGathering | undefined;
};

export async function plan_automation_triggers(
  db: DatabaseExecutor,
  owner: AutomationTriggerOwner,
  triggers: AutomationTriggerInput[],
  open_provider_triggers_leaving = 0,
): Promise<PlannedAutomationTrigger[]> {
  const planned = await Promise.all(
    triggers.map((trigger) => plan_automation_trigger(db, owner, trigger)),
  );
  await refuse_provider_triggers_above_plan_limit(db, {
    workspace_id: owner.workspace_id,
    opening: planned.filter((plan) => is_provider_trigger(plan.row)).length,
    closing: open_provider_triggers_leaving,
    created_via: owner.created_via,
  });
  return planned;
}

async function plan_schedule_trigger(
  db: DatabaseExecutor,
  owner: AutomationTriggerOwner,
  shared: Omit<CreateTriggerInput, 'trigger_type' | 'trigger_config'>,
  input: Extract<AutomationTriggerInput, { kind: 'schedule' }>,
): Promise<PlannedAutomationTrigger> {
  const timezone = input.timezone ?? (await read_user_timezone(db, owner.actor_id));
  const row: CreateTriggerInput = {
    ...shared,
    trigger_type: 'schedule',
    schedule_expression: input.cron,
    trigger_config: {
      starts_job_handler: automation_job_handler,
      ...(timezone ? { timezone } : {}),
    },
  };
  return { row, connected_account_id: null };
}

async function plan_automation_trigger(
  db: DatabaseExecutor,
  owner: AutomationTriggerOwner,
  input: AutomationTriggerInput,
): Promise<PlannedAutomationTrigger> {
  const shared = {
    workspace_id: owner.workspace_id,
    agent_id: owner.agent_id,
    automation_id: owner.automation_id,
    trigger_name: input.trigger_name ?? owner.automation_name,
    trigger_source: build_automation_trigger_source(owner),
    actor_id: owner.actor_id,
  };
  if (input.kind === 'schedule') return plan_schedule_trigger(db, owner, shared, input);
  if (input.kind === 'manual') {
    const row: CreateTriggerInput = {
      ...shared,
      trigger_type: 'manual',
      trigger_config: { starts_job_handler: automation_job_handler },
    };
    return { row, connected_account_id: null };
  }
  if (input.kind === 'webhook') {
    const { new_webhook_secret, webhook_secret_hash } = create_trigger_webhook_secret();
    const row: CreateTriggerInput = {
      ...shared,
      trigger_type: 'webhook',
      trigger_config: { starts_job_handler: automation_job_handler, webhook_secret_hash },
    };
    return { row, connected_account_id: null, new_webhook_secret };
  }
  const gathering = owner.gathering ?? gathering_of_the_signer_alone(owner.actor_id);
  return plan_app_event_trigger(db, shared, input, gathering);
}
