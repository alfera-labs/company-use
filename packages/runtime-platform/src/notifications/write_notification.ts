import type { Database } from '@coworker/core';
import { record_notification_outcome } from '@coworker/core/db/queries/notification_outcomes';
import type { NotificationOutcome } from '@coworker/core/db/schema/automation_contracts';
import type { IdeasFileWriters } from '@runtime-platform/notifications/ideas_file';
import {
  type Notification,
  type NotificationInput,
  notification_fingerprint,
  notification_schema,
} from '@runtime-platform/notifications/notification_body';
import {
  count_spent_today,
  keep_the_cap_after_the_write,
  prepare_the_decision,
} from '@runtime-platform/notifications/notification_daily_cap';
import { follow_through_on_notification } from '@runtime-platform/notifications/notification_follow_through';
import {
  already_notified,
  build_outcome_row,
} from '@runtime-platform/notifications/notification_outcome_row';
import {
  notification_rules_file_name,
  read_notification_rules_file,
} from '@runtime-platform/notifications/notification_rules_file';
import { find_the_person_it_is_for } from '@runtime-platform/notifications/notification_subject_reads';

export type WriteNotificationInput = {
  workspace_id: string;
  agent_id: string;
  actor_id: string;
  written_by: 'run' | 'platform';
  only_the_principal_reads?: boolean | undefined;
  notification: NotificationInput;
  now?: Date;
  policy_readers?: Parameters<typeof read_notification_rules_file>[2];
  ideas_writers?: IdeasFileWriters;
};

export type WriteNotificationResult = {
  notification_event_id: string | null;
  notification_fingerprint: string;
  outcome: NotificationOutcome;
  outcome_reason: string;
  delivered_on: string | null;
  delivery_ref: string | null;
  delivery_error: string | null;
  policy_hash: string;
};

export async function write_notification(
  db: Database,
  input: WriteNotificationInput,
): Promise<WriteNotificationResult> {
  const claim = await claim_notification(db, input);
  const { notification } = claim;
  const fingerprint = notification_fingerprint(input.workspace_id, notification);
  const now = input.now ?? new Date();
  const rules = await read_notification_rules_file(
    db,
    { workspace_id: input.workspace_id, agent_id: input.agent_id },
    input.policy_readers ?? {},
  );
  if (rules.parse_failed || rules.read_failed) {
    await report_unreadable_notification_rules(db, input, notification, now, rules);
  }
  const decide = await prepare_the_decision(db, input.workspace_id, rules, notification, now);
  const spent_input = { workspace_id: input.workspace_id, policy: rules.policy, notification };
  const first_decision = decide(await count_spent_today(db, spent_input));
  const row = build_outcome_row(input, { ...claim, fingerprint, decision: first_decision, rules });
  const written = await record_notification_outcome(db, row);
  if (!written) return already_notified(fingerprint, rules.policy_hash);

  const decision =
    first_decision.outcome === 'notify_now'
      ? await keep_the_cap_after_the_write(db, input, written.event_id, decide, spent_input)
      : first_decision;
  const delivery = await follow_through_on_notification(db, {
    ...input,
    event_id: written.event_id,
    notification,
    decision,
    policy: rules.policy,
    now,
  });
  return {
    notification_event_id: written.event_id,
    notification_fingerprint: fingerprint,
    outcome: decision.outcome,
    outcome_reason: decision.outcome_reason,
    ...delivery,
    policy_hash: rules.policy_hash,
  };
}

async function claim_notification(db: Database, input: WriteNotificationInput) {
  const parsed = notification_schema.parse(input.notification);
  const claimed = { ...parsed, principal_id: await find_the_person_it_is_for(db, input, parsed) };
  const urgency_was_coerced = input.written_by === 'run' && claimed.urgency === 'system_problem';
  const notification = urgency_was_coerced ? { ...claimed, urgency: 'deadline' as const } : claimed;
  return { notification, urgency_was_coerced };
}

const unparsed_policy_subject = notification_rules_file_name;

async function report_unreadable_notification_rules(
  db: Database,
  input: WriteNotificationInput,
  notification: Notification,
  now: Date,
  attention: { read_failed: boolean; read_failed_reason?: string },
) {
  if (notification.subject === unparsed_policy_subject) return;
  const day = now.toISOString().slice(0, 10);
  const said = attention.read_failed
    ? {
        claim: `could not be read on ${day}`,
        title: 'Your notification-rules.md could not be read; using defaults',
        body: `The workspace files volume did not answer for notification-rules.md, so the default notification rules is in force: ${attention.read_failed_reason ?? 'no reason given'}`,
      }
    : {
        claim: `did not parse on ${day}`,
        title: 'Your notification-rules.md did not parse; using defaults',
        body: 'The settings block at the top of notification-rules.md could not be read, so the default notification rules is in force until it is fixed.',
      };
  await write_notification(db, {
    ...input,
    written_by: 'platform',
    notification: {
      run_id: notification.run_id,
      session_id: notification.session_id,
      principal_id: notification.principal_id,
      subject: unparsed_policy_subject,
      ...said,
      urgency: attention.read_failed ? 'fyi' : 'system_problem',
      score: 100,
      reason:
        'The workspace notification rules is unreadable and the defaults are deciding instead.',
      evidence: { run_ids: [notification.run_id] },
    },
    now,
  });
}
