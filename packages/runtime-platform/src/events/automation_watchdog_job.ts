import type { Database, event_jobs, events } from '@coworker/core';
import { list_triggers } from '@coworker/core/db/queries/trigger_reads';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { resend_unconfirmed_schedules } from '@runtime-platform/automations/schedule_resend';
import {
  confirm_wire_health,
  read_trigger_wire_health,
  record_dead_wire,
  type TriggerWireHealth,
  type WatchdogWireReader,
} from '@runtime-platform/automations/trigger_wire_health';
import {
  type ComplaintKind,
  file_watchdog_complaint,
} from '@runtime-platform/automations/watchdog_complaint';
import {
  read_fired_system_trigger,
  system_job_skipped,
} from '@runtime-platform/events/system_trigger_fire';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { redeliver_undelivered_notifications } from '@runtime-platform/notifications/redeliver_notifications';
import { is_native_trigger_node_key } from '@runtime-platform/tools/native_trigger_seed';

const log = create_logger('automation_watchdog');
const watchdog_actor = 'system:automation_watchdog';
const silent_after_hours = 24;

type WatchdogJobInput = {
  db: Database;
  workspace_id: string;
  events: (typeof events.$inferSelect)[];
  event_jobs?: (typeof event_jobs.$inferSelect)[];
  now?: Date;
  wire_reader?: WatchdogWireReader;
};

export async function run_automation_watchdog_job(
  input: WatchdogJobInput,
): Promise<EventJobHandlerResult> {
  const fire = await read_fired_system_trigger(input.db, input.events);
  if (!fire) return system_job_skipped('No system trigger fire was available.', 'no_trigger');
  const now = input.now ?? new Date();

  const watched = (await list_triggers(input.db, input.workspace_id)).filter(is_watched_trigger);
  const complaints = await complain_about_every_trigger(input, watched, {
    workspace_id: input.workspace_id,
    agent_id: fire.trigger.agent_id,
    run_id: input.event_jobs?.[0]?.job_id ?? fire.event.event_id,
    event_id: fire.event.event_id,
    now,
  });
  const schedules_resent = await resend_unconfirmed_schedules(input.db, watched, now);

  const redeliveries = await redeliver_undelivered_notifications(input.db, {
    workspace_id: input.workspace_id,
    agent_id: fire.trigger.agent_id,
    actor_id: watchdog_actor,
    now,
  });

  if (complaints.length > 0) {
    log.warn('the watchdog found silent or broken ears', {
      workspace_id: input.workspace_id,
      complaints: complaints.length,
    });
  }
  const result_data = { ran: true, triggers_checked: watched.length, complaints, redeliveries };
  return { job_status: 'done', result_data: { ...result_data, schedules_resent } };
}

async function complain_about_every_trigger(
  input: WatchdogJobInput,
  watched: TriggerRow[],
  fire: { workspace_id: string; agent_id: string; run_id: string; event_id: string; now: Date },
) {
  const health = await read_trigger_wire_health(
    input.db,
    input.workspace_id,
    watched,
    input.wire_reader,
    fire.now,
  );
  const complaints: { trigger_id: string; kind: string; outcome: string }[] = [];
  for (const trigger of watched) {
    const verdict = health.get(trigger.trigger_id) ?? { is_dead: false, detail: '' };
    const wire = await confirm_wire_health(input.db, trigger, verdict, fire.now);
    complaints.push(...(await complain_about_one_trigger(input.db, { ...fire, trigger, wire })));
  }
  return complaints;
}

function is_watched_trigger(trigger: TriggerRow) {
  return (
    Boolean(trigger.automation_id) &&
    (trigger.trigger_status === 'enabled' || trigger.trigger_status === 'error')
  );
}

function complaints_about(trigger: TriggerRow, now: Date, wire_is_dead: boolean): ComplaintKind[] {
  const kinds: ComplaintKind[] = [];
  if (trigger.trigger_config.needs_connection) return ['needs_connection'];
  const is_native_ear = is_native_trigger_node_key(trigger.trigger_config.event_source?.node_key);
  const is_enabled = trigger.trigger_status === 'enabled';
  if (
    is_enabled &&
    trigger.trigger_type === 'app_event' &&
    !is_native_ear &&
    has_gone_silent(trigger, now)
  ) {
    kinds.push('silent');
  }
  if (wire_is_dead) kinds.push('dead_wire');
  return kinds;
}

function has_gone_silent(trigger: TriggerRow, now: Date) {
  const last_heard = trigger.last_run_time ?? trigger.created_time;
  return hours_since(last_heard, now) >= silent_after_hours;
}

async function complain_about_one_trigger(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    run_id: string;
    event_id: string;
    trigger: TriggerRow;
    now: Date;
    wire: TriggerWireHealth;
  },
) {
  const complaints: { trigger_id: string; kind: ComplaintKind; outcome: string }[] = [];
  for (const kind of complaints_about(input.trigger, input.now, input.wire.is_dead)) {
    const outcome = await file_watchdog_complaint(db, {
      ...input,
      kind,
      detail: complaint_detail(kind, input.trigger, input.wire.detail, input.now),
    });
    if (kind === 'dead_wire') await record_dead_wire(db, input.trigger, input.wire.detail);
    complaints.push({ trigger_id: input.trigger.trigger_id, kind, outcome });
  }
  return complaints;
}

function complaint_detail(kind: ComplaintKind, trigger: TriggerRow, wire: string, now: Date) {
  if (kind === 'dead_wire') return `${wire} Reconnect the app to start hearing again.`;
  if (kind === 'needs_connection') {
    const app = trigger.trigger_config.needs_connection;
    return `This automation was saved before ${app} was connected, so this watcher has no subscription yet. Connect ${app}, then provision the automation to start hearing.`;
  }
  return silence_detail(trigger, now);
}

function silence_detail(trigger: TriggerRow, now: Date) {
  const since = trigger.last_run_time ?? trigger.created_time;
  const days = Math.floor(hours_since(since, now) / 24);
  const when = since.toISOString().slice(0, 16).replace('T', ' ');
  return [
    trigger.last_run_time
      ? `Nothing has arrived on this watcher since ${when} UTC (${days} days).`
      : `This watcher has never heard anything since it was set up on ${when} UTC (${days} days).`,
    'Either nothing has happened, or the connection behind it needs reconnecting. Check it.',
  ].join(' ');
}

function hours_since(then: Date, now: Date) {
  return (now.getTime() - then.getTime()) / 3_600_000;
}
