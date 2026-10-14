import type { Database } from '@coworker/core';
import { set_notification_delivery } from '@coworker/core/db/queries/notification_outcomes';
import {
  action_asks_the_person,
  type NotificationOutcome,
} from '@coworker/core/db/schema/automation_contracts';
import { create_logger, format_error_message } from '@coworker/shared';
import {
  count_feed_as_undelivered,
  deliver_to_person,
} from '@runtime-platform/delivery/deliver_to_person';
import type { NotificationQuestion } from '@runtime-platform/delivery/notification_slack_card';
import {
  append_parked_idea,
  type IdeasFileWriters,
} from '@runtime-platform/notifications/ideas_file';
import {
  type Notification,
  notification_because_line,
  notification_next_step,
} from '@runtime-platform/notifications/notification_body';
import type { NotificationDecision } from '@runtime-platform/notifications/notification_outcome';
import type { NotificationRules } from '@runtime-platform/notifications/notification_rules_file';
import { native_trigger_node_keys } from '@runtime-platform/tools/native_trigger_seed';

const log = create_logger('write_notification');

export type WrittenNotification = {
  workspace_id: string;
  agent_id: string;
  actor_id: string;
  event_id: string;
  notification: Notification;
  decision: NotificationDecision;
  policy: NotificationRules;
  now: Date;
  ideas_writers?: IdeasFileWriters | undefined;
  only_the_principal_reads?: boolean | undefined;
};

export async function follow_through_on_notification(db: Database, input: WrittenNotification) {
  const { notification, decision, now } = input;
  if (decision.outcome === 'add_to_ideas_list' && !input.only_the_principal_reads) {
    await append_parked_idea(
      db,
      { workspace_id: input.workspace_id, agent_id: input.agent_id, notification, now },
      input.ideas_writers ?? {},
    );
  }
  const delivery =
    decision.outcome === 'notify_now'
      ? await deliver_and_record(db, input)
      : { delivered_on: null, delivery_ref: null, delivery_error: null };
  if (!input.only_the_principal_reads) {
    await fire_notification_ears(db, {
      workspace_id: input.workspace_id,
      event_id: input.event_id,
      notification,
      outcome: decision.outcome,
      now,
    });
  }
  log.info('a notification was judged', {
    workspace_id: input.workspace_id,
    outcome: decision.outcome,
    score: notification.score,
    delivered_on: delivery.delivered_on,
  });
  return delivery;
}

async function fire_notification_ears(
  db: Database,
  input: {
    workspace_id: string;
    event_id: string;
    notification: Notification;
    outcome: NotificationOutcome;
    now: Date;
  },
) {
  const { notification } = input;
  try {
    const { fire_automation_ears } = await import(
      '@runtime-platform/automations/fire_automation_ears'
    );
    await fire_automation_ears(db, {
      workspace_id: input.workspace_id,
      node_key: native_trigger_node_keys.notification_written,
      occurrence_key: input.event_id,
      received_time: input.now,
      skip_automation_id: notification.automation_id,
      data: {
        title: notification.title,
        urgency: notification.urgency,
        outcome: input.outcome,
        score: notification.score,
        automation_id: notification.automation_id,
        subject: notification.subject,
        evidence: notification.evidence,
      },
    });
  } catch (error) {
    log.error('the notification ears could not be fired', {
      workspace_id: input.workspace_id,
      event_id: input.event_id,
      error: format_error_message(error),
    });
  }
}

async function deliver_and_record(
  db: Database,
  input: Pick<
    WrittenNotification,
    'workspace_id' | 'event_id' | 'actor_id' | 'policy' | 'notification'
  >,
) {
  const reached = await deliver_to_person(db, {
    workspace_id: input.workspace_id,
    session_id: input.notification.session_id,
    principal_id: input.notification.principal_id,
    delivery_channel_order: input.policy.delivery_channel_order,
    question: notification_question(input.event_id, input.notification),
    message: {
      title: input.notification.title,
      body: input.notification.body,
      because: notification_because_line(input.notification),
      next_step: notification_next_step(input.notification.proposed_action),
    },
  });
  const delivery = count_feed_as_undelivered(reached);

  await set_notification_delivery(db, {
    workspace_id: input.workspace_id,
    event_id: input.event_id,
    actor_id: input.actor_id,
    delivery,
  });
  return delivery;
}

export function notification_question(
  event_id: string,
  notification: Pick<Notification, 'session_id' | 'proposed_action'>,
): NotificationQuestion | null {
  if (!notification.session_id) return null;
  if (!action_asks_the_person(notification.proposed_action?.kind)) return null;
  return { notification_event_id: event_id, session_id: notification.session_id };
}
