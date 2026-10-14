import type { Database } from '@coworker/core';
import { demote_notification_to_daily_summary } from '@coworker/core/db/queries/notification_demotion';
import { count_notifications_sent_today } from '@coworker/core/db/queries/notification_outcomes';
import type { Notification } from '@runtime-platform/notifications/notification_body';
import {
  choose_notification_outcome,
  type NotificationDecision,
} from '@runtime-platform/notifications/notification_outcome';
import type {
  NotificationRules,
  read_notification_rules_file,
} from '@runtime-platform/notifications/notification_rules_file';
import { notification_rules_timezone } from '@runtime-platform/notifications/notification_rules_schema';
import { read_automation_the_policy_names } from '@runtime-platform/notifications/notification_subject_reads';

function wait_while_the_rules_are_unread(
  read_failed: boolean,
  input: Parameters<typeof choose_notification_outcome>[0],
): NotificationDecision {
  const decision = choose_notification_outcome(input);
  if (!read_failed || decision.outcome !== 'notify_now') return decision;
  return {
    outcome: 'add_to_daily_summary',
    outcome_reason: 'notification-rules.md could not be read, so this waits for the daily summary',
    held: null,
  };
}

export type SpentToday = {
  notifications_sent_today: number;
  notifications_sent_today_for_automation: number;
};
export type SpentTodayInput = {
  workspace_id: string;
  policy: NotificationRules;
  notification: Notification;
  up_to_event_id?: string;
};

export async function count_spent_today(db: Database, input: SpentTodayInput): Promise<SpentToday> {
  const count = (automation_id?: string | null) =>
    count_notifications_sent_today(db, {
      workspace_id: input.workspace_id,
      principal_id: input.notification.principal_id,
      timezone: notification_rules_timezone(input.policy),
      automation_id,
      up_to_event_id: input.up_to_event_id,
    });
  const has_own_daily_limit =
    Object.keys(input.policy.own_daily_limit).length > 0 && input.notification.automation_id;
  return {
    notifications_sent_today: await count(),
    notifications_sent_today_for_automation: has_own_daily_limit
      ? await count(input.notification.automation_id)
      : 0,
  };
}

export async function keep_the_cap_after_the_write(
  db: Database,
  input: { workspace_id: string; actor_id: string },
  event_id: string,
  decide: (spent: SpentToday) => ReturnType<typeof choose_notification_outcome>,
  spent_input: SpentTodayInput,
) {
  const rank = await count_spent_today(db, { ...spent_input, up_to_event_id: event_id });
  const decision = decide({
    notifications_sent_today: Math.max(rank.notifications_sent_today - 1, 0),
    notifications_sent_today_for_automation: Math.max(
      rank.notifications_sent_today_for_automation - 1,
      0,
    ),
  });
  if (decision.outcome === 'notify_now') return decision;
  const demoted = {
    outcome: 'add_to_daily_summary' as const,
    outcome_reason: decision.outcome_reason,
    held: decision.held,
  };
  await demote_notification_to_daily_summary(db, {
    workspace_id: input.workspace_id,
    event_id,
    outcome_reason: demoted.outcome_reason,
    held: demoted.held,
    actor_id: input.actor_id,
  });
  return demoted;
}

type RulesRead = Awaited<ReturnType<typeof read_notification_rules_file>>;

export async function prepare_the_decision(
  db: Database,
  workspace_id: string,
  rules: RulesRead,
  notification: Notification,
  now: Date,
) {
  const named = await read_automation_the_policy_names(
    db,
    workspace_id,
    rules.policy,
    notification,
  );
  return (spent: SpentToday) =>
    wait_while_the_rules_are_unread(rules.read_failed, {
      policy: rules.policy,
      score: notification.score,
      urgency: notification.urgency,
      automation_id: notification.automation_id,
      automation_name: named.automation_name,
      expires_time: notification.expires_time,
      proposed_action_kind: notification.proposed_action?.kind ?? null,
      ...spent,
      now,
    });
}
