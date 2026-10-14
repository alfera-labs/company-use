import { escape_slack_entities } from '@runtime-platform/channels/slack/message_format';
import {
  chat_url,
  decision_button,
  notification_no_action_id,
  notification_yes_action_id,
  open_in_alfera_button,
} from '@runtime-platform/tools/policies/approval_card_parts';

export type NotificationQuestion = {
  notification_event_id: string;
  session_id: string;
  yes_label?: string;
};

export function build_notification_card(
  message: { title: string; body: string; because: string },
  question: NotificationQuestion,
) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${escape_slack_entities(message.title)}*\n${escape_slack_entities(message.body)}`,
      },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Because: ${escape_slack_entities(message.because)}` }],
    },
    {
      type: 'actions',
      elements: [
        decision_button(
          question.yes_label ?? 'Yes',
          'primary',
          notification_yes_action_id,
          question.notification_event_id,
        ),
        decision_button('No', null, notification_no_action_id, question.notification_event_id),
        open_in_alfera_button(chat_url(question.session_id)),
      ],
    },
  ];
}
