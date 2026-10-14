import { product_brand_config } from '@coworker/config';
import type { Database, events } from '@coworker/core';
import {
  append_notification_follow_up,
  find_last_summary_time,
  list_open_notifications,
  type Notification,
} from '@coworker/core/db/queries/notification_outcomes';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { deliver_to_person } from '@runtime-platform/delivery/deliver_to_person';
import {
  read_fired_system_trigger,
  system_job_skipped,
} from '@runtime-platform/events/system_trigger_fire';
import { notification_next_step } from '@runtime-platform/notifications/notification_body';
import { local_minutes_of_day } from '@runtime-platform/notifications/notification_clock';
import {
  type NotificationRules,
  read_notification_rules_file,
} from '@runtime-platform/notifications/notification_rules_file';
import { notification_rules_timezone } from '@runtime-platform/notifications/notification_rules_schema';

const log = create_logger('daily_summary');
const daily_summary_actor = 'system:daily_summary';
const daily_summary_window_minutes = 15;
const one_daily_summary_per_hours = 20;
const daily_summary_row_limit = 50;

type DailySummaryJobInput = {
  db: Database;
  workspace_id: string;
  events: (typeof events.$inferSelect)[];
  now?: Date;
};

export async function run_daily_summary_job(
  input: DailySummaryJobInput,
): Promise<EventJobHandlerResult> {
  const fire = await read_fired_system_trigger(input.db, input.events);
  if (!fire) return system_job_skipped('No system trigger fire was available.', 'no_trigger');
  const now = input.now ?? new Date();

  const { policy } = await read_notification_rules_file(input.db, {
    workspace_id: input.workspace_id,
    agent_id: fire.trigger.agent_id,
  });
  const window_reason = daily_summary_window_is_closed(now, policy);
  if (window_reason) return system_job_skipped(window_reason, 'outside_daily_summary_window');

  const last_daily_summary_time = await find_last_summary_time(input.db, input.workspace_id);
  if (
    last_daily_summary_time &&
    hours_since(last_daily_summary_time, now) < one_daily_summary_per_hours
  ) {
    return system_job_skipped(
      'A daily summary already went out today.',
      'daily_summary_already_sent',
    );
  }

  const waiting = await list_open_notifications(input.db, {
    workspace_id: input.workspace_id,
    outcomes: ['add_to_daily_summary'],
    limit: daily_summary_row_limit,
  });
  if (waiting.length === 0)
    return system_job_skipped('Nothing was waiting.', 'daily_summary_empty');

  const editions = await Promise.all(
    group_by_person(waiting).map((edition) =>
      send_one_edition(input.db, { workspace_id: input.workspace_id, policy, edition }),
    ),
  );
  log.info('a daily summary went out', { workspace_id: input.workspace_id, rows: waiting.length });

  return {
    job_status: 'done',
    result_data: {
      ran: true,
      summarized: editions.reduce((total, edition) => total + edition.summarized, 0),
      editions: editions.map(({ principal_id, delivered_on, delivery_error }) => ({
        principal_id,
        delivered_on,
        delivery_error,
      })),
    },
  };
}

function group_by_person(rows: Notification[]) {
  const by_person = new Map<string | null, Notification[]>();
  for (const row of rows) {
    const edition = by_person.get(row.notification.principal_id) ?? [];
    edition.push(row);
    by_person.set(row.notification.principal_id, edition);
  }
  return [...by_person.entries()].map(([principal_id, edition_rows]) => ({
    principal_id,
    rows: edition_rows,
  }));
}

async function send_one_edition(
  db: Database,
  input: {
    workspace_id: string;
    policy: NotificationRules;
    edition: { principal_id: string | null; rows: Notification[] };
  },
) {
  const { rows, principal_id } = input.edition;
  const delivery = await deliver_to_person(db, {
    workspace_id: input.workspace_id,
    session_id: rows.find((row) => row.notification.session_id)?.notification.session_id ?? null,
    principal_id,
    delivery_channel_order: [...new Set([input.policy.daily_summary_channel, 'web' as const])],
    message: {
      title: `Your daily summary: ${rows.length} ${rows.length === 1 ? 'thing' : 'things'} that waited`,
      body: rows.map(daily_summary_entry).join('\n\n'),
      because: 'each of these was worth telling you, but not worth interrupting you for',
      next_step: `Open ${product_brand_config.product_brand_name} to act on any of them.`,
    },
  });

  const follow_ups = await Promise.all(
    rows.map((row) =>
      append_notification_follow_up(db, {
        workspace_id: input.workspace_id,
        fingerprint: row.fingerprint,
        subject: row.queue_key,
        follow_up: 'summarized',
        outcome_event_id: row.event_id,
        actor_id: daily_summary_actor,
      }),
    ),
  );
  const summarized = follow_ups.filter(Boolean).length;
  if (delivery.delivery_error) {
    log.warn('a daily summary edition could not be delivered', {
      workspace_id: input.workspace_id,
      principal_id,
      delivery_error: delivery.delivery_error,
    });
  }
  return { principal_id, summarized, ...delivery };
}

function daily_summary_entry(row: Notification) {
  const because = read_score_reason(row) ?? row.notification.outcome_reason;
  return [
    row.notification.title,
    `Because: ${because}`,
    `Next: ${notification_next_step(row.notification.proposed_action)}`,
  ].join('\n');
}

function read_score_reason(row: Notification) {
  const reason = row.notification.metadata.score_reason;
  return typeof reason === 'string' && reason.trim() ? reason : null;
}

function daily_summary_window_is_closed(now: Date, policy: NotificationRules) {
  if (policy.dial === 'off') return 'The dial is off, so nothing is summarized.';
  const timezone = notification_rules_timezone(policy);
  if (policy.daily_summary_cadence === 'weekdays' && is_weekend(now, timezone)) {
    return `It is the weekend in ${timezone}, and the daily summary is for weekdays.`;
  }
  const [hours = '0', minutes = '0'] = policy.daily_summary_at_time.split(':');
  const daily_summary_minutes = Number(hours) * 60 + Number(minutes);
  const minutes_now = local_minutes_of_day(now, timezone);
  const since_daily_summary_time = (minutes_now - daily_summary_minutes + 1_440) % 1_440;
  if (since_daily_summary_time < daily_summary_window_minutes) return null;
  return `It is not ${policy.daily_summary_at_time} in ${timezone} yet.`;
}

function is_weekend(now: Date, timezone: string) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
    now,
  );
  return weekday === 'Sat' || weekday === 'Sun';
}

function hours_since(then: Date, now: Date) {
  return (now.getTime() - then.getTime()) / 3_600_000;
}
