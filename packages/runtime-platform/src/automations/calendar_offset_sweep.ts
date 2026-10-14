import type { Database } from '@coworker/core';
import { find_or_create_session_for_external_thread } from '@coworker/core/db/queries/sessions';
import { list_triggers } from '@coworker/core/db/queries/trigger_reads';
import { create_logger, format_error_message } from '@coworker/shared';
import { fire_trigger } from '@runtime-platform/events/fire_trigger';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import {
  find_connected_calendar_node,
  list_upcoming_calendar_events,
  type ScoutCalendarEvent,
} from '@runtime-platform/scout/scout_calendar';
import {
  calendar_offset_minutes_limit,
  native_trigger_node_keys,
} from '@runtime-platform/tools/native_trigger_seed';
import { apply_trigger_rules } from '@runtime-platform/triggers/trigger_rules';

const log = create_logger('calendar_offset_sweep');
const sweep_actor = 'system:calendar_offset_sweep';
const minute_ms = 60_000;

const calendar_offset_sweep_minutes = 15;
const lookback_minutes = 60;

const calendar_offset_node_keys: string[] = [
  native_trigger_node_keys.google_calendar_event_offset,
  native_trigger_node_keys.outlook_calendar_event_offset,
];

export type CalendarOffsetSweepResult = {
  ran: boolean;
  code?: string;
  ears: number;
  events_read: number;
  fired: Array<{ trigger_id: string; event_id: string; offset_minutes: number }>;
  silent: Array<{ trigger_id: string; event_id: string; reason: string }>;
};

type CalendarOffsetEar = {
  trigger: TriggerRow;
  offset_minutes: number;
  relative_to: 'start' | 'end';
};

export async function sweep_calendar_offsets(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    now: Date;
    list_events?: typeof list_upcoming_calendar_events | undefined;
    find_calendar?: typeof find_connected_calendar_node | undefined;
  },
): Promise<CalendarOffsetSweepResult> {
  const ears = read_calendar_offset_ears(await list_triggers(db, input.workspace_id));
  const empty = { ears: ears.length, events_read: 0, fired: [], silent: [] };
  if (ears.length === 0) return { ran: false, code: 'no_calendar_offset_ears', ...empty };

  const find_calendar = input.find_calendar ?? find_connected_calendar_node;
  if (!(await find_calendar(db, input.workspace_id))) {
    return { ran: false, code: 'no_calendar_connection', ...empty };
  }

  const events = await read_horizon(db, { ...input, ears });
  if (!events) {
    log.warn('calendar offset sweep skipped: the calendar could not be read', {
      workspace_id: input.workspace_id,
    });
    return { ran: false, code: 'calendar_read_failed', ...empty };
  }
  const fired: CalendarOffsetSweepResult['fired'] = [];
  const silent: CalendarOffsetSweepResult['silent'] = [];
  for (const ear of ears) {
    for (const event of events) {
      await fire_one_due_event(db, { ear, event, now: input.now, fired, silent });
    }
  }
  return { ran: true, ears: ears.length, events_read: events.length, fired, silent };
}

async function read_horizon(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    now: Date;
    ears: CalendarOffsetEar[];
    list_events?: typeof list_upcoming_calendar_events | undefined;
  },
) {
  const offsets = input.ears.map((ear) => ear.offset_minutes);
  const from_minutes = -Math.max(0, ...offsets) - lookback_minutes;
  const to_minutes = -Math.min(0, ...offsets) + calendar_offset_sweep_minutes;
  const session = await find_or_create_session_for_external_thread(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    session_source: 'trigger',
    external_thread_key: `calendar_offset_sweep:${input.workspace_id}`,
    session_title: 'Calendar offset sweep',
    source_metadata: { kind: 'calendar_offset_sweep', runtime_response_is_user_visible: false },
    actor_id: sweep_actor,
  });
  const list_events = input.list_events ?? list_upcoming_calendar_events;
  return list_events(db, {
    workspace_id: input.workspace_id,
    session_id: session.session_id,
    now: new Date(input.now.getTime() + from_minutes * minute_ms),
    days: (to_minutes - from_minutes) / (24 * 60),
    limit: 250,
  });
}

async function fire_one_due_event(
  db: Database,
  input: {
    ear: CalendarOffsetEar;
    event: ScoutCalendarEvent;
    now: Date;
    fired: CalendarOffsetSweepResult['fired'];
    silent: CalendarOffsetSweepResult['silent'];
  },
) {
  const { ear, event } = input;
  if (!event.event_id || !is_due(event, ear, input.now)) return;
  const data = { ...event.event, event_id: event.event_id };
  const rules = apply_trigger_rules(ear.trigger.trigger_config.rules ?? [], data);
  if (!rules.passed) {
    input.silent.push({
      trigger_id: ear.trigger.trigger_id,
      event_id: event.event_id,
      reason: rules.reason,
    });
    return;
  }
  try {
    const result = await fire_trigger(db, ear.trigger, {
      occurrence_key: `${event.event_id}:${ear.offset_minutes}`,
      delivery: {
        provider: 'native',
        trigger_slug: ear.trigger.trigger_config.event_source?.node_key ?? 'calendar_event_offset',
        received_time: input.now.toISOString(),
        data,
      },
    });
    if (result?.fired) {
      input.fired.push({
        trigger_id: ear.trigger.trigger_id,
        event_id: event.event_id,
        offset_minutes: ear.offset_minutes,
      });
    }
  } catch (error) {
    log.error('a calendar offset ear could not be fired', {
      trigger_id: ear.trigger.trigger_id,
      event_id: event.event_id,
      error: format_error_message(error),
    });
  }
}

// Due now, or due while the last sweep was not looking. Never early: a reminder that arrives
// before the person asked for it is a wrong reminder.
// A 15-minute sweep means up to 15 minutes late. Upgrade path if that is not good
// enough: one scheduled trigger per occurrence instead of a polling window.
function is_due(event: ScoutCalendarEvent, ear: CalendarOffsetEar, now: Date) {
  const anchor = Date.parse((ear.relative_to === 'end' && event.ends) || event.when);
  if (Number.isNaN(anchor)) return false;
  const due_ms = anchor + ear.offset_minutes * minute_ms;
  return due_ms <= now.getTime() && due_ms > now.getTime() - lookback_minutes * minute_ms;
}

// The workspace's triggers, filtered in memory — the same read fire_automation_ears does.
function read_calendar_offset_ears(triggers: TriggerRow[]): CalendarOffsetEar[] {
  return triggers.flatMap((trigger) => {
    const source = trigger.trigger_config.event_source;
    if (!trigger.automation_id || trigger.trigger_status !== 'enabled') return [];
    if (!source || !calendar_offset_node_keys.includes(source.node_key)) return [];
    const offset_minutes = Number(source.subscription_config?.offset_minutes);
    if (!Number.isInteger(offset_minutes)) return [];
    if (Math.abs(offset_minutes) > calendar_offset_minutes_limit) return [];
    const relative_to = source.subscription_config?.relative_to === 'end' ? 'end' : 'start';
    return [{ trigger, offset_minutes, relative_to }];
  });
}
