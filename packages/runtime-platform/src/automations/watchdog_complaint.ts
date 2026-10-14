import type { Database } from '@coworker/core';
import { get_automation } from '@coworker/core/db/queries/automation_reads';
import { list_trigger_apps_by_node_id } from '@coworker/core/db/queries/trigger_apps';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { write_notification } from '@runtime-platform/notifications/write_notification';

export type ComplaintKind = 'silent' | 'dead_wire' | 'needs_connection';

const complaint_headlines: Record<ComplaintKind, string> = {
  silent: 'nothing has come in yet',
  dead_wire: 'is no longer connected',
  needs_connection: 'was never connected',
};

const complaint_claims: Record<ComplaintKind, string> = {
  silent: 'has not fired',
  dead_wire: 'its connection is broken',
  needs_connection: 'it is waiting for the app to be connected',
};

const complaint_weights: Record<
  ComplaintKind,
  { urgency: 'system_problem' | 'fyi'; score: number }
> = {
  silent: { urgency: 'fyi', score: 40 },
  dead_wire: { urgency: 'system_problem', score: 80 },
  needs_connection: { urgency: 'system_problem', score: 80 },
};

const watchdog_actor = 'system:automation_watchdog';

type ComplaintInput = {
  workspace_id: string;
  agent_id: string;
  run_id: string;
  event_id: string;
  trigger: TriggerRow;
  kind: ComplaintKind;
  detail: string;
  now: Date;
};

export async function file_watchdog_complaint(db: Database, input: ComplaintInput) {
  const written = await write_notification(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    actor_id: watchdog_actor,
    written_by: 'platform',
    now: input.now,
    notification: {
      automation_id: input.trigger.automation_id,
      run_id: input.run_id,
      subject: `watchdog:${input.kind}:${input.trigger.trigger_id}:${day_key(input.now)}`,
      claim: complaint_claims[input.kind],
      title: await write_complaint_title(db, input),
      body: input.detail,
      evidence: { event_ids: [input.event_id] },
      ...complaint_weights[input.kind],
      reason: `the daily check looked at this ${input.kind === 'silent' ? 'trigger' : 'connection'}`,
    },
  });
  return written.outcome;
}

async function write_complaint_title(db: Database, input: ComplaintInput) {
  const automation = input.trigger.automation_id
    ? await get_automation(db, {
        workspace_id: input.workspace_id,
        automation_id: input.trigger.automation_id,
      })
    : null;
  const automation_name = automation?.automation_name ?? input.trigger.trigger_name;
  const waiting_for = input.trigger.trigger_config.needs_connection;
  if (input.kind === 'needs_connection' && waiting_for) {
    return `${automation_name} needs ${waiting_for} connected`;
  }
  const app = await read_app_display_name(db, input.trigger);
  if (input.kind === 'silent')
    return `${automation_name}: ${complaint_headlines.silent} from ${app}`;
  return `${automation_name}: ${app} ${complaint_headlines[input.kind]}`;
}

async function read_app_display_name(db: Database, trigger: TriggerRow) {
  if (!trigger.node_id) return 'the app';
  const apps = await list_trigger_apps_by_node_id(db, [trigger.node_id]);
  return apps.get(trigger.node_id)?.app_display_name ?? 'the app';
}

function day_key(now: Date) {
  return now.toISOString().slice(0, 10);
}
