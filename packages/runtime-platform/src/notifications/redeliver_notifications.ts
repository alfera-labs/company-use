import type { Database } from '@coworker/core';
import {
  list_open_notifications,
  type Notification,
  set_notification_delivery,
} from '@coworker/core/db/queries/notification_outcomes';
import type { DeliveryChannel } from '@coworker/core/db/schema/automation_contracts';
import { create_logger } from '@coworker/shared';
import {
  count_feed_as_undelivered,
  deliver_to_person,
} from '@runtime-platform/delivery/deliver_to_person';
import { notification_next_step } from '@runtime-platform/notifications/notification_body';
import { notification_question } from '@runtime-platform/notifications/notification_follow_through';
import { read_notification_rules_file } from '@runtime-platform/notifications/notification_rules_file';

const log = create_logger('redeliver_notifications');
const undelivered_grace_minutes = 15;
const redelivery_marker = 'redelivered_time';

export type Redelivery = { notification_event_id: string; delivered_on: string | null };

export async function redeliver_undelivered_notifications(
  db: Database,
  input: { workspace_id: string; agent_id: string; actor_id: string; now?: Date },
): Promise<Redelivery[]> {
  const now = input.now ?? new Date();
  // The open interruptions, filtered in memory — there are at most a handful a day by
  // construction (the daily cap). Upgrade path: a delivered_on IS NULL predicate in core.
  const open = await list_open_notifications(db, {
    workspace_id: input.workspace_id,
    outcomes: ['notify_now'],
  });
  const stranded = open.filter((row) => was_never_delivered(row, now));
  if (stranded.length === 0) return [];

  const { policy } = await read_notification_rules_file(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
  });

  const redeliveries: Redelivery[] = [];
  for (const row of stranded) {
    redeliveries.push(
      await redeliver_one_notification(db, {
        ...input,
        row,
        now,
        delivery_channel_order: policy.delivery_channel_order,
      }),
    );
  }

  log.warn('interruptions were re-driven', {
    workspace_id: input.workspace_id,
    count: redeliveries.length,
  });
  return redeliveries;
}

async function redeliver_one_notification(
  db: Database,
  input: {
    workspace_id: string;
    actor_id: string;
    row: Notification;
    now: Date;
    delivery_channel_order: readonly DeliveryChannel[];
  },
): Promise<Redelivery> {
  const { row } = input;
  const { notification } = row;
  await set_notification_delivery(db, {
    workspace_id: input.workspace_id,
    event_id: row.event_id,
    actor_id: input.actor_id,
    delivery: {
      delivered_on: null,
      delivery_ref: notification.delivery_ref,
      delivery_error: notification.delivery_error,
    },
    metadata: { ...notification.metadata, [redelivery_marker]: input.now.toISOString() },
  });
  const reached = await deliver_to_person(db, {
    workspace_id: input.workspace_id,
    session_id: notification.session_id,
    principal_id: notification.principal_id,
    delivery_channel_order: input.delivery_channel_order,
    question: notification_question(row.event_id, notification),
    message: {
      title: notification.title,
      body: notification.body,
      because: read_score_reason(row) ?? notification.outcome_reason,
      next_step: notification_next_step(notification.proposed_action),
    },
  });
  const delivery = count_feed_as_undelivered(reached);
  await set_notification_delivery(db, {
    workspace_id: input.workspace_id,
    event_id: row.event_id,
    actor_id: input.actor_id,
    delivery,
  });
  return { notification_event_id: row.event_id, delivered_on: delivery.delivered_on };
}

function was_never_delivered(row: Notification, now: Date) {
  if (row.notification.delivered_on || row.notification.metadata[redelivery_marker]) return false;
  const age_minutes = (now.getTime() - row.created_time.getTime()) / 60_000;
  return age_minutes >= undelivered_grace_minutes;
}

function read_score_reason(row: Notification) {
  const reason = row.notification.metadata.score_reason;
  return typeof reason === 'string' && reason.trim() ? reason : null;
}
