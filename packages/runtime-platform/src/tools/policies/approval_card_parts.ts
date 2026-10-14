import { public_env } from '@coworker/config/public_env';

export const approval_approve_action_id = 'approval_approve';
export const approval_refuse_action_id = 'approval_refuse';
export const approval_always_action_id = 'approval_always';
export const approval_allow_chat_action_id = 'approval_allow_chat';
export const approval_allow_30_days_action_id = 'approval_allow_30_days';
export const approval_allow_automation_action_id = 'approval_allow_automation';
export const approval_approve_batch_action_id = 'approval_approve_batch';

export const notification_yes_action_id = 'notification_yes';
export const notification_no_action_id = 'notification_no';

export const allow_days = 30;

export const tool_permissions_settings_path = 'Settings → Tool permissions';
export const settings_footer = `You can change what needs approval anytime in ${tool_permissions_settings_path}.`;

const max_field_value_length = 120;

export function decision_button(
  label: string,
  style: string | null,
  action_id: string,
  value: string,
) {
  return {
    type: 'button',
    text: { type: 'plain_text', text: label, emoji: true },
    ...(style ? { style } : {}),
    action_id,
    value,
  };
}

export function open_in_alfera_button(url = inbox_url()) {
  return {
    type: 'button',
    text: { type: 'plain_text', text: 'Open in Alfera', emoji: true },
    url,
  };
}

export function inbox_url() {
  return new URL('/inbox', public_env.NEXT_PUBLIC_APP_URL).toString();
}

export function chat_url(session_id: string) {
  return new URL(`/chats/${session_id}`, public_env.NEXT_PUBLIC_APP_URL).toString();
}

export function clip(value: string) {
  const single_line = value.replace(/\s+/gu, ' ').trim();
  if (single_line.length <= max_field_value_length) return single_line;
  return `${single_line.slice(0, max_field_value_length)}…`;
}
