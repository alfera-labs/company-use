import type { Database, event_jobs, events } from '@coworker/core';
import { get_automation } from '@coworker/core/db/queries/automation_reads';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger, format_error_message } from '@coworker/shared';
import { automation_fire_still_waiting_for_credit } from '@runtime-platform/automations/automation_billing_hold';
import {
  record_run_progress,
  refuse_fire_over_budget,
} from '@runtime-platform/automations/automation_budget_guard';
import {
  read_all_automation_fires,
  read_latest_automation_fire,
} from '@runtime-platform/automations/automation_fire';
import { fire_was_sent_from_the_workspace_address } from '@runtime-platform/automations/automation_fire_sender';
import {
  nothing_to_run,
  ran_result,
  skipped,
} from '@runtime-platform/automations/automation_job_results';
import { run_the_subject } from '@runtime-platform/automations/run_automation_subject';
import { enqueue_triage_for_dropped_fire } from '@runtime-platform/automations/triage_enqueue';
import { find_workspace_email_address } from '@runtime-platform/channels/email/address_lifecycle';
import { find_finished_event_job_run } from '@runtime-platform/events/event_job_started_run';

type EventRecord = typeof events.$inferSelect;
type EventJob = typeof event_jobs.$inferSelect;

type AutomationJobInput = {
  db: Database;
  workspace_id: string;
  queue_key?: string;
  event_jobs?: EventJob[];
  events: EventRecord[];
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
};

export async function run_automation_job(
  input: AutomationJobInput,
): Promise<EventJobHandlerResult> {
  const fire = read_latest_automation_fire(input.events);
  if (!fire) return nothing_to_run('No trigger.fired event was available.');

  const trigger = await get_trigger_by_id(input.db, fire.trigger_id);
  if (!trigger) return nothing_to_run(`Trigger ${fire.trigger_id} no longer exists.`);
  if (!trigger.automation_id) {
    return nothing_to_run(`Trigger ${trigger.trigger_id} belongs to no automation.`);
  }

  const recovered = await adopt_the_run_this_job_started(input, trigger.automation_id, trigger);
  if (recovered) return recovered;

  const waiting = await automation_fire_still_waiting_for_credit(input.db, {
    workspace_id: input.workspace_id,
    event_jobs: input.event_jobs ?? [],
  });
  if (waiting) return waiting;

  const automation = await get_automation(input.db, {
    workspace_id: input.workspace_id,
    automation_id: trigger.automation_id,
  });
  if (!automation || automation.automation_status === 'archived') {
    return nothing_to_run(
      `Automation ${trigger.automation_id} no longer exists.`,
      'automation_deleted',
    );
  }
  if (automation.automation_status !== 'enabled') {
    const message = `Automation ${automation.automation_id} is ${automation.automation_status}.`;
    return nothing_to_run(message, 'automation_not_enabled');
  }

  const fire_event_id = input.events.find((record) => record.source === 'trigger')?.event_id;
  const now = new Date();
  const refused = await refuse_the_fire(input, { automation, trigger, fire, fire_event_id, now });
  if (refused) return refused;

  if (automation.run_policy.listen) {
    const listened = skipped(automation, trigger, {
      stage: 'listen',
      reason: `${automation.automation_name} only listens; nothing runs on a fire.`,
    });
    return triage_what_nobody_took(input, { automation, trigger, fire, result: listened });
  }

  const result = await run_the_subject(input, {
    trigger,
    automation,
    fire,
    batch: read_all_automation_fires(input.events),
  });
  const started_run_id = result.run_id;
  if (started_run_id && fire_event_id) {
    await record_run_progress(input.db, {
      workspace_id: input.workspace_id,
      automation,
      run_id: started_run_id,
      fire_event_id,
      now,
    });
  }
  return triage_what_nobody_took(input, { automation, trigger, fire, result });
}

type Automation = NonNullable<Awaited<ReturnType<typeof get_automation>>>;

async function refuse_the_fire(
  input: AutomationJobInput,
  context: {
    automation: Automation;
    trigger: NonNullable<Awaited<ReturnType<typeof get_trigger_by_id>>>;
    fire: NonNullable<ReturnType<typeof read_latest_automation_fire>>;
    fire_event_id: string | undefined;
    now: Date;
  },
): Promise<EventJobHandlerResult | null> {
  const workspace_mail = await find_workspace_email_address(input.db, input.workspace_id);
  if (
    fire_was_sent_from_the_workspace_address(context.fire.delivery, workspace_mail.email_address)
  ) {
    return skipped(context.automation, context.trigger, {
      stage: 'own_mail',
      reason: 'The workspace itself sent this mail, so nothing runs on it.',
    });
  }
  if (!context.fire_event_id) return null;
  return refuse_fire_over_budget(input.db, {
    workspace_id: input.workspace_id,
    automation: context.automation,
    fire_event_id: context.fire_event_id,
    now: context.now,
  });
}

async function adopt_the_run_this_job_started(
  input: AutomationJobInput,
  automation_id: string,
  trigger: NonNullable<Awaited<ReturnType<typeof get_trigger_by_id>>>,
): Promise<EventJobHandlerResult | null> {
  const started_run = await find_finished_event_job_run(input.db, {
    workspace_id: input.workspace_id,
    event_jobs: input.event_jobs ?? [],
    include_failed_with_progress: true,
  });
  if (!started_run) return null;
  return ran_result({ automation_id }, trigger, {
    ...started_run,
    subject_is_known: true,
    recovered_started_run: true,
    ...(started_run.run_status === 'failed' ? { failed: true } : {}),
  });
}

const log = create_logger('run_automation');

async function triage_what_nobody_took(
  input: AutomationJobInput,
  context: {
    automation: Awaited<ReturnType<typeof get_automation>>;
    trigger: Awaited<ReturnType<typeof get_trigger_by_id>>;
    fire: NonNullable<ReturnType<typeof read_latest_automation_fire>>;
    result: EventJobHandlerResult;
  },
): Promise<EventJobHandlerResult> {
  const fire_event = input.events.find((record) => record.source === 'trigger');
  if (!context.automation || !context.trigger || !fire_event) return context.result;
  try {
    await enqueue_triage_for_dropped_fire(input.db, {
      workspace_id: input.workspace_id,
      queue_key: input.queue_key,
      automation: context.automation,
      trigger: context.trigger,
      fire: context.fire,
      fire_event_id: fire_event.event_id,
      result: context.result,
    });
  } catch (error) {
    log.error('the signal could not be queued for triage', {
      workspace_id: input.workspace_id,
      trigger_id: context.trigger.trigger_id,
      error: format_error_message(error),
    });
  }
  return context.result;
}
