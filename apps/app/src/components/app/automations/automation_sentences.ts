import type {
  AutomationFire,
  AutomationTrigger,
  Notification,
  NotificationRules,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import { describe_fire_outcome } from '@/components/app/automations/fire_outcome_words';
import { find_trigger_type } from '@/components/app/automations/trigger_types_model';
import { describe_schedule } from '@/lib/scheduled_task_schedule';

type TriggerConfig = { event_source?: { node_key?: string } | undefined };

export function describe_trigger_start(
  trigger: AutomationTrigger,
  catalog?: TriggerTypeCatalog,
): string {
  if (trigger.trigger_type === 'manual') return 'When you ask';
  if (trigger.trigger_type === 'webhook') return 'When anything on the web calls it';
  if (trigger.trigger_type === 'schedule') return describe_schedule(trigger.schedule_expression);
  const source = ((trigger.trigger_config ?? {}) as TriggerConfig).event_source;
  const listed = source?.node_key ? find_trigger_type(catalog, source.node_key) : null;
  return listed?.row.display_name ?? trigger.trigger_name;
}

export function describe_tell_you(
  policy: NotificationRules,
  automation: { automation_id: string; automation_name: string },
): string[] {
  const named = (list: string[]) =>
    list.includes(automation.automation_id) || list.includes(automation.automation_name);
  if (named(policy.never_notify)) return ['Summary only for this one.'];
  if (named(policy.always_notify)) return ['Always notify you about this one.'];
  if (policy.dial === 'off') return ['Summary only. Nothing arrives on its own.'];
  const channels = policy.delivery_channel_order.map(channel_words).join(', ');
  const quiet = policy.quiet_hours
    ? `Nothing between ${policy.quiet_hours.start} and ${policy.quiet_hours.end}, unless a deadline would pass.`
    : 'No quiet hours.';
  return [
    `Notify you on ${channels} when it matters, at most ${policy.max_notifications_per_day} times a day.`,
    quiet,
    `Everything else waits for the ${policy.daily_summary_at_time} summary.`,
  ];
}

const channel_names: Record<string, string> = {
  slack_dm: 'Slack',
  email: 'email',
  web: 'this page',
};

function channel_words(channel: string) {
  return channel_names[channel] ?? channel;
}

export type AutomationHistoryRow = {
  row_key: string;
  when: string;
  outcome: AutomationFire['outcome'];
  headline: string;
  sentence: string;
  parked: boolean;
  session_id: string | null;
};

export function build_automation_history(input: {
  fires: AutomationFire[];
  notifications: Notification[];
  summary_time?: string | undefined;
}): AutomationHistoryRow[] {
  const told_event_ids = new Set(input.fires.map((fire) => fire.told?.notification_event_id));
  const rows = [
    ...input.fires.map((fire) => fire_history_row(fire, input.summary_time)),
    ...input.notifications
      .filter(is_quiet_notification)
      .filter((notification) => !told_event_ids.has(notification.event_id))
      .map(notification_history_row),
  ];
  return rows.sort((left, right) => right.when.localeCompare(left.when));
}

function fire_history_row(fire: AutomationFire, summary_time?: string): AutomationHistoryRow {
  return {
    row_key: fire.event_id,
    when: as_iso(fire.fired_time),
    outcome: fire.outcome,
    headline: fire.trigger_name ?? 'Started',
    sentence: describe_fire_outcome(fire, summary_time),
    parked: fire.told?.outcome === 'add_to_ideas_list',
    session_id: fire.session_id,
  };
}

function is_quiet_notification(notification: Notification) {
  return notification.outcome in quiet_outcome_words;
}

const quiet_outcome_words: Partial<Record<Notification['outcome'], string>> = {
  add_to_ideas_list: 'Parked on Ideas',
  drop_with_reason: 'Stayed quiet',
};

function notification_history_row(notification: Notification): AutomationHistoryRow {
  const words = quiet_outcome_words[notification.outcome] ?? 'Stayed quiet';
  const reason = notification.notification.outcome_reason;
  return {
    row_key: notification.event_id,
    when: as_iso(notification.created_time),
    outcome: 'skipped',
    headline: notification.notification.title,
    sentence: reason ? `${words}: ${reason}` : words,
    parked: notification.outcome === 'add_to_ideas_list',
    session_id: notification.notification.session_id,
  };
}

function as_iso(value: string | Date | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : value;
}
