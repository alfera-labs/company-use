import { build_scheduled_task_run_authority, type Database } from '@coworker/core';
import type { get_automation } from '@coworker/core/db/queries/automation_reads';
import { record_platform_user_as_speaker } from '@coworker/core/db/queries/session_speakers';
import type { RunTriggerType } from '@coworker/core/db/queries/sessions';
import { open_automation_run_chat } from '@runtime-platform/automations/automation_run_chat';
import { build_automation_run_instruction } from '@runtime-platform/automations/automation_run_instruction';
import { read_reaching_the_person } from '@runtime-platform/automations/reaching_the_person';
import type { TriggerFireDelivery, TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { read_notification_rules_guidance } from '@runtime-platform/notifications/notification_rules_file';
import {
  type AgentRunJob,
  start_agent_run_for_job,
} from '@runtime-platform/orchestrator/agent_run_job';
import type { TriggerJudgeVerdict } from '@runtime-platform/triggers/trigger_judge';

export type Automation = NonNullable<Awaited<ReturnType<typeof get_automation>>>;

const automation_actor = 'system:trigger';

const run_trigger_type_by_ear: Record<string, RunTriggerType> = {
  schedule: 'schedule',
  system_event: 'schedule',
  app_event: 'app_event',
  webhook: 'app_event',
  manual: 'manual',
};

export type StartedAutomationRun = { session_id: string; run_id: string };

export async function start_automation_run(
  db: Database,
  input: {
    workspace_id: string;
    automation: Automation;
    trigger: TriggerRow;
    session_key: string;
    subject_value: string;
    subject_is_known: boolean;
    subject_is_resolved: boolean;
    delivery?: TriggerFireDelivery | undefined;
    verdict?: TriggerJudgeVerdict | null | undefined;
    job?: AgentRunJob;
  },
): Promise<StartedAutomationRun> {
  const { automation, trigger } = input;
  const source_metadata = {
    automation_id: automation.automation_id,
    instruction_version: automation.instruction_version,
    instruction: automation.instruction,
    trigger_id: trigger.trigger_id,
    ...(build_scheduled_task_run_authority(
      trigger.trigger_id,
      trigger.trigger_source,
      automation.instruction,
    ) ?? {}),
  };

  const session = await open_automation_run_chat(db, automation, {
    session_key: input.session_key,
    source_metadata,
    actor_id: automation_actor,
  });
  await register_the_person_who_can_answer(db, {
    workspace_id: input.workspace_id,
    session_id: session.session_id,
    created_by: automation.created_by,
  });

  const instruction = await compose_run_instruction(db, input);

  const run = await start_agent_run_for_job(
    db,
    {
      workspace_id: input.workspace_id,
      session_id: session.session_id,
      user_content: [{ type: 'text', text: instruction }],
      source_type: 'runtime',
      user_message_source_metadata: source_metadata,
      run_metadata: source_metadata,
      trigger_type: run_trigger_type_by_ear[trigger.trigger_type] ?? 'schedule',
      trigger_id: trigger.trigger_id,
      automation_id: automation.automation_id,
      actor_id: automation_actor,
    },
    input.job,
  );

  return { session_id: session.session_id, run_id: run.run_id };
}

async function register_the_person_who_can_answer(
  db: Database,
  input: { workspace_id: string; session_id: string; created_by: string },
) {
  if (!input.created_by.startsWith('user_')) return;
  await record_platform_user_as_speaker(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    user_id: input.created_by,
  });
}

async function compose_run_instruction(
  db: Database,
  input: Parameters<typeof start_automation_run>[1],
) {
  const attention_guidance = await read_notification_rules_guidance(db, {
    workspace_id: input.workspace_id,
    agent_id: input.automation.agent_id,
  });
  const person = await read_reaching_the_person(db, {
    workspace_id: input.workspace_id,
    agent_id: input.automation.agent_id,
    created_by: input.automation.created_by,
  });
  return build_automation_run_instruction({
    attention_guidance,
    person,
    automation_name: input.automation.automation_name,
    automation_id: input.automation.automation_id,
    instruction: input.automation.instruction,
    subject_value: input.subject_value,
    subject_is_known: input.subject_is_known,
    subject_is_resolved: input.subject_is_resolved,
    delivery: input.delivery,
    verdict: input.verdict,
    sends_without_asking: input.automation.run_policy.sends_without_asking === true,
  });
}
