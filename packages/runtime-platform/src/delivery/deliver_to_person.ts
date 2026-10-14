import type { Database } from '@coworker/core';
import { get_user } from '@coworker/core/db/queries/users';
import { list_workspace_member_users } from '@coworker/core/db/queries/workspace_membership';
import type { DeliveryChannel } from '@coworker/core/db/schema/automation_contracts';
import { create_logger, format_error_message } from '@coworker/shared';
import { send_workspace_email } from '@runtime-platform/channels/email/outbound_email';
import { find_active_slack_connection_for_workspace } from '@runtime-platform/channels/slack/workspace_connection';
import { deliver_by_chat } from '@runtime-platform/delivery/chat_delivery';
import {
  build_notification_card,
  type NotificationQuestion,
} from '@runtime-platform/delivery/notification_slack_card';
import {
  lookup_slack_user_id_by_email,
  open_slack_dm_channel,
  post_slack_message,
  read_slack_bot_token,
} from '@runtime-platform/tools/slack/channels_api';

const log = create_logger('deliver_to_person');

export type PersonMessage = {
  title: string;
  body: string;
  because: string;
  next_step: string;
};

export type DeliveryOutcome = {
  delivered_on: DeliveryChannel | null;
  delivery_ref: string | null;
  delivery_error: string | null;
};

export type DeliveryRequest = {
  workspace_id: string;
  session_id: string | null;
  principal_id: string | null;
  delivery_channel_order: readonly DeliveryChannel[];
  message: PersonMessage;
  question?: NotificationQuestion | null;
};

type Recipient = { user_id: string; email: string | null };

type DeliveryContext = DeliveryRequest & { db: Database; recipients: Recipient[]; text: string };

const delivery_channels: Record<
  DeliveryChannel,
  (context: DeliveryContext) => Promise<string | null>
> = {
  chat: (context) =>
    deliver_by_chat(context.db, {
      workspace_id: context.workspace_id,
      principal_id: context.principal_id,
      text: context.text,
    }),
  slack_dm: deliver_by_slack_dm,
  email: deliver_by_email,
  web: async () => 'feed',
};

export async function deliver_to_person(
  db: Database,
  request: DeliveryRequest,
): Promise<DeliveryOutcome> {
  const recipients = await read_recipients(db, request);
  const context: DeliveryContext = {
    ...request,
    db,
    recipients,
    text: build_notification_message(request.message),
  };
  const failures: string[] = [];

  for (const channel of order_with_chat_first(request.delivery_channel_order)) {
    try {
      const delivery_ref = await delivery_channels[channel](context);
      if (delivery_ref) {
        const delivery_error =
          channel === 'web' && failures.length > 0 ? failures.join('; ') : null;
        return { delivered_on: channel, delivery_ref, delivery_error };
      }
      failures.push(`${channel}: no way to reach them`);
    } catch (error) {
      const message = format_error_message(error);
      log.warn('a notification could not be delivered on a channel', {
        workspace_id: request.workspace_id,
        channel,
        message,
      });
      failures.push(`${channel}: ${message}`);
    }
  }

  return {
    delivered_on: null,
    delivery_ref: null,
    delivery_error: failures.join('; ') || 'no channel was configured',
  };
}

export function count_feed_as_undelivered(delivery: DeliveryOutcome): DeliveryOutcome {
  if (delivery.delivered_on !== 'web') return delivery;
  return {
    delivered_on: null,
    delivery_ref: null,
    delivery_error: delivery.delivery_error ?? 'only the feed could show it',
  };
}

function order_with_chat_first(delivery_channel_order: readonly DeliveryChannel[]) {
  return delivery_channel_order.includes('chat')
    ? delivery_channel_order
    : (['chat', ...delivery_channel_order] as const);
}

export function build_notification_message(message: PersonMessage) {
  return [
    message.title,
    '',
    message.body,
    '',
    `Because: ${message.because}`,
    `Next: ${message.next_step}`,
  ].join('\n');
}

async function read_recipients(db: Database, request: DeliveryRequest): Promise<Recipient[]> {
  if (request.principal_id) {
    const user = await get_user(db, request.principal_id);
    return user ? [{ user_id: user.user_id, email: user.email ?? null }] : [];
  }
  const members = await list_workspace_member_users(db, request.workspace_id);
  return members.map((member) => ({ user_id: member.user_id, email: member.email ?? null }));
}

async function deliver_by_slack_dm(context: DeliveryContext) {
  const connection = await find_active_slack_connection_for_workspace(
    context.db,
    context.workspace_id,
  );
  const token = read_slack_bot_token(connection);
  if (!token) return null;

  for (const recipient of context.recipients) {
    if (!recipient.email) continue;
    const slack_user_id = await lookup_slack_user_id_by_email(token, recipient.email);
    if (!slack_user_id) continue;
    const dm_channel = await open_slack_dm_channel(token, slack_user_id);
    if (!dm_channel) continue;
    const message_ts = await post_slack_message(
      token,
      dm_channel,
      context.text,
      context.question
        ? { blocks: build_notification_card(context.message, context.question) }
        : {},
    );
    return `${dm_channel}:${message_ts ?? ''}`;
  }
  return null;
}

async function deliver_by_email(context: DeliveryContext) {
  if (!context.session_id) return null;
  const to = context.recipients.flatMap((recipient) => (recipient.email ? [recipient.email] : []));
  if (to.length === 0) return null;

  const sent = await send_workspace_email(context.db, {
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    to,
    subject: context.message.title,
    text: context.text,
    actor_id: 'system:attention',
  });
  return sent.email_id;
}
