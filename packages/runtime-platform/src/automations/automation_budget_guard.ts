import type { Database } from '@coworker/core';
import {
  clear_automation_no_progress_streak,
  count_one_more_run_without_progress,
} from '@coworker/core/db/queries/automation_budget';
import { count_automation_fires_today } from '@coworker/core/db/queries/automation_fires';
import type {} from '@coworker/core/db/queries/events';
import { run_made_progress } from '@coworker/core/db/queries/run_progress';
import { read_automation_budget } from '@coworker/core/db/schema/automation_contracts';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { nothing_to_run } from '@runtime-platform/automations/automation_job_results';
import { read_automation_lifecycle } from '@runtime-platform/automations/automation_lifecycle';
import type { Automation } from '@runtime-platform/automations/start_automation_run';
import { write_notification } from '@runtime-platform/notifications/write_notification';

const budget_actor = 'system:automation_budget';

export async function refuse_fire_over_budget(
  db: Database,
  input: { workspace_id: string; automation: Automation; fire_event_id: string; now: Date },
): Promise<EventJobHandlerResult | null> {
  const budget = read_automation_budget(input.automation.run_policy);
  const reset_time = input.automation.metadata?.budget_reset_time;
  const fires_today = await count_automation_fires_today(db, {
    workspace_id: input.workspace_id,
    automation_id: input.automation.automation_id,
    now: input.now,
    ...(typeof reset_time === 'string' ? { budget_reset_time: new Date(reset_time) } : {}),
  });
  if (fires_today <= budget.max_fires_per_day) return null;
  const reason = `it fired ${fires_today} times today, past its budget of ${budget.max_fires_per_day}`;
  await pause_the_automation(db, { ...input, reason });
  return nothing_to_run(
    `Automation ${input.automation.automation_name} paused: ${reason}`,
    'automation_over_budget',
    { budget_limit: budget.max_fires_per_day },
  );
}

export async function record_run_progress(
  db: Database,
  input: {
    workspace_id: string;
    automation: Automation;
    run_id: string;
    fire_event_id: string;
    now: Date;
  },
): Promise<void> {
  const identity = {
    workspace_id: input.workspace_id,
    automation_id: input.automation.automation_id,
    actor_id: budget_actor,
  };
  if (await run_made_progress(db, { workspace_id: input.workspace_id, run_id: input.run_id })) {
    await clear_automation_no_progress_streak(db, identity);
    return;
  }
  const streak = await count_one_more_run_without_progress(db, identity);
  const budget = read_automation_budget(input.automation.run_policy);
  if (streak < budget.max_no_progress_runs) return;
  await pause_the_automation(db, {
    ...input,
    reason: `${streak} runs in a row changed nothing`,
  });
}

async function pause_the_automation(
  db: Database,
  input: {
    workspace_id: string;
    automation: Automation;
    fire_event_id: string;
    reason: string;
    now: Date;
  },
) {
  const { automation } = input;
  await read_automation_lifecycle().set_automation_status(db, {
    workspace_id: input.workspace_id,
    automation_id: automation.automation_id,
    automation_status: 'paused',
    actor_id: budget_actor,
  });
  await write_notification(db, {
    workspace_id: input.workspace_id,
    agent_id: automation.agent_id,
    actor_id: budget_actor,
    written_by: 'platform',
    now: input.now,
    notification: {
      automation_id: automation.automation_id,
      run_id: input.fire_event_id,
      subject: `automation_budget:${automation.automation_id}:${input.now.toISOString().slice(0, 10)}`,
      claim: 'was paused for running away',
      title: `Automation ${automation.automation_name} paused: ${input.reason}`,
      body: [
        `${automation.automation_name} was paused because ${input.reason}.`,
        'Nothing it was doing is lost — turn it back on once you have changed what it listens for or what it does, and its budget starts over.',
      ].join(' '),
      urgency: 'system_problem',
      evidence: { event_ids: [input.fire_event_id] },
      score: 80,
      reason: `its budget said ${input.reason}`,
    },
  });
}
