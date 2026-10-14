import {
  answer_on_the_card,
  ephemeral_reply,
  type SlackClickPress,
  type SlackClickReply,
} from '@api/services/channels/slack_click_payload';
import type { Database } from '@coworker/core';
import type { Notification } from '@coworker/core/db/queries/notification_outcomes';
import {
  append_notification_follow_up,
  find_notification,
} from '@coworker/core/db/queries/notification_outcomes';
import { find_user_by_email } from '@coworker/core/db/queries/users';
import { workspace_member_is_active } from '@coworker/core/db/queries/workspace_membership';
import { find_active_slack_connection } from '@runtime-platform/channels/slack/channel_event_dispatch';
import { enqueue_notification_answer } from '@runtime-platform/events/notification_answer_job';
import {
  notification_no_action_id,
  notification_yes_action_id,
} from '@runtime-platform/tools/policies/approval_card_parts';
import {
  lookup_slack_user_email,
  read_slack_bot_token,
} from '@runtime-platform/tools/slack/channels_api';

const answers_by_action_id: Record<string, 'yes' | 'no'> = {
  [notification_yes_action_id]: 'yes',
  [notification_no_action_id]: 'no',
};

export async function answer_notification_press(
  db: Database,
  press: SlackClickPress,
): Promise<SlackClickReply | null> {
  const answer = answers_by_action_id[press.action_id];
  if (!answer) return null;

  const connection = await find_active_slack_connection(db, { team_id: press.team_id });
  const token = connection ? read_slack_bot_token(connection) : null;
  if (!connection || !token) {
    return ephemeral_reply('This Slack workspace is not connected to Alfera.');
  }

  const workspace_id = connection.workspace_id;
  const notification = await find_notification(db, { workspace_id, event_id: press.value });
  if (!notification) return ephemeral_reply('That is not here anymore. Open Alfera to check.');

  const answered_by = await find_the_person_who_pressed(db, {
    workspace_id,
    token,
    slack_user_id: press.slack_user_id,
  });
  if (!answered_by) {
    return ephemeral_reply(
      'Only somebody in this workspace can answer this — open Alfera to check.',
    );
  }

  if (answer === 'no') {
    await close_the_notification(db, {
      workspace_id,
      notification,
      answered_by,
      ending: 'dismissed',
    });
    return answer_on_the_card(press, 'Noted, dropped.');
  }

  const session_id = notification.notification.session_id;
  if (!session_id) {
    return ephemeral_reply('There is no chat to answer in. Open Alfera to take it from here.');
  }

  // Queued, not started: the run that wrote this card is often still finishing and holds the
  // session, and the events engine waits that out. Only rows are written here, so the card is
  // answered well inside Slack's three seconds.
  const queued = await enqueue_notification_answer(db, {
    workspace_id,
    session_id,
    notification_event_id: notification.event_id,
    answered_by,
    answer: 'yes',
  });
  if (queued.reason === 'answer_session_missing') {
    return ephemeral_reply('There is no chat to answer in. Open Alfera to take it from here.');
  }
  await close_the_notification(db, { workspace_id, notification, answered_by, ending: 'acted' });
  return answer_on_the_card(press, '✓ Yes — on it.');
}

function close_the_notification(
  db: Database,
  input: {
    workspace_id: string;
    notification: Notification;
    answered_by: string;
    ending: 'acted' | 'dismissed';
  },
) {
  return append_notification_follow_up(db, {
    workspace_id: input.workspace_id,
    fingerprint: input.notification.fingerprint,
    subject: input.notification.queue_key,
    follow_up: input.ending,
    outcome_event_id: input.notification.event_id,
    actor_id: input.answered_by,
  });
}

async function find_the_person_who_pressed(
  db: Database,
  input: { workspace_id: string; token: string; slack_user_id: string },
) {
  const email = await lookup_slack_user_email(input.token, input.slack_user_id);
  if (!email) return null;

  const user = await find_user_by_email(db, email);
  if (!user) return null;

  const is_member = await workspace_member_is_active(db, {
    workspace_id: input.workspace_id,
    user_id: user.user_id,
  });
  return is_member ? user.user_id : null;
}
