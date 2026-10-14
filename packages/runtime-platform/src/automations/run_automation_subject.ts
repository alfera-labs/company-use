import type { Database, event_jobs } from '@coworker/core';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { hold_automation_fire_for_billing_refusal } from '@runtime-platform/automations/automation_billing_hold';
import type { AutomationFire } from '@runtime-platform/automations/automation_fire';
import { fire_was_written_by_the_person } from '@runtime-platform/automations/automation_fire_sender';
import { read_human_handover } from '@runtime-platform/automations/automation_human_handover';
import { ran_result, skipped } from '@runtime-platform/automations/automation_job_results';
import {
  read_automation_subject,
  read_session_key_for_fire,
  read_subject_value_from_session_key,
  read_trigger_node_subject_field,
  type SubjectSource,
} from '@runtime-platform/automations/automation_subject';
import {
  find_automation_subject_session,
  read_automation_subject_state,
} from '@runtime-platform/automations/automation_subject_state';
import {
  decide_whether_to_run,
  type RunDecision,
} from '@runtime-platform/automations/decide_whether_to_run';
import {
  type Automation,
  start_automation_run,
} from '@runtime-platform/automations/start_automation_run';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { read_agent_run_job } from '@runtime-platform/orchestrator/agent_run_job';
import { apply_trigger_rules } from '@runtime-platform/triggers/trigger_rules';

export type AutomationSubjectJobInput = {
  db: Database;
  workspace_id: string;
  queue_key?: string;
  event_jobs?: (typeof event_jobs.$inferSelect)[];
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
};

export async function run_the_subject(
  input: AutomationSubjectJobInput,
  context: {
    trigger: TriggerRow;
    automation: Automation;
    fire: AutomationFire;
    batch?: readonly AutomationFire[] | undefined;
  },
): Promise<EventJobHandlerResult> {
  const { db, workspace_id } = input;
  const { automation, trigger, fire } = context;
  const subject = read_automation_subject({
    run_policy: automation.run_policy,
    node_subject_field: await read_trigger_node_subject_field(db, trigger),
    delivery: fire.delivery,
    occurrence_key: fire.occurrence_key,
  });
  const subject_source = subject.source;

  const session_key = read_session_key_for_fire(input.queue_key, automation, subject);
  const known_session = await find_automation_subject_session(db, {
    workspace_id,
    agent_id: automation.agent_id,
    session_key,
  });

  const handover = known_session
    ? await read_human_handover(
        db,
        workspace_id,
        known_session,
        read_subject_value_from_session_key(session_key),
        fire,
        context.batch ?? [],
      )
    : read_own_mail_refusal(fire);
  if (handover) return skipped(automation, trigger, handover, { subject_source });

  const ear_refusal = known_session ? null : read_ear_refusal(trigger, fire);
  if (ear_refusal) return skipped(automation, trigger, ear_refusal, { subject_source });

  const decision: RunDecision = known_session
    ? { runs: true, verdict: null }
    : await decide_whether_to_run(db, {
        workspace_id,
        agent_id: automation.agent_id,
        automation_id: automation.automation_id,
        conditions: automation.conditions,
        judge: automation.judge,
        data: fire.delivery?.data ?? {},
      });
  if (!decision.runs) {
    return skipped(automation, trigger, decision.skipped, {
      ...(decision.verdict ? { verdict: decision.verdict } : {}),
      subject_source,
    });
  }

  return start_the_run(input, {
    ...context,
    session_key,
    subject_source,
    known_session,
    verdict: decision.verdict,
  });
}

function read_ear_refusal(trigger: TriggerRow, fire: AutomationFire) {
  const rules = apply_trigger_rules(trigger.trigger_config?.rules ?? [], fire.delivery?.data ?? {});
  return rules.passed ? null : { stage: 'ear_rule', reason: rules.reason };
}

async function start_the_run(
  input: AutomationSubjectJobInput,
  context: {
    trigger: TriggerRow;
    automation: Automation;
    fire: AutomationFire;
    session_key: string;
    subject_source: SubjectSource;
    known_session: { session_metadata: Record<string, unknown> } | null | undefined;
    verdict: RunDecision['verdict'];
  },
): Promise<EventJobHandlerResult> {
  const { automation, trigger, fire, session_key, known_session } = context;
  const started = await start_automation_run(input.db, {
    workspace_id: input.workspace_id,
    automation,
    trigger,
    session_key,
    subject_value: read_subject_value_from_session_key(session_key) ?? session_key,
    subject_is_known: Boolean(known_session),
    subject_is_resolved: Boolean(
      known_session && read_automation_subject_state(known_session).resolved_time,
    ),
    delivery: fire.delivery,
    verdict: context.verdict,
    job: read_agent_run_job(input),
  }).catch((error: unknown) =>
    hold_automation_fire_for_billing_refusal(error, input.event_jobs ?? []),
  );
  if ('held' in started) return started.held;

  return ran_result(automation, trigger, {
    ...started,
    subject_is_known: Boolean(known_session),
    subject_source: context.subject_source,
    ...(context.verdict ? { judge: context.verdict } : {}),
  });
}

function read_own_mail_refusal(fire: AutomationFire) {
  if (!fire_was_written_by_the_person(fire.delivery)) return null;
  return { stage: 'human', reason: 'The person sent this; their own mail starts no run.' };
}
