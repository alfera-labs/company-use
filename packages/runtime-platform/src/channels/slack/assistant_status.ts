import type { WebClient } from '@slack/web-api';

const slack_status_max_characters = 50;

const slack_working_status = 'Thinking...';

const slack_working_status_messages = [
  'Understanding...',
  'Evaluating...',
  'Organising...',
  'Working...',
] as const;

export type SlackAssistantStatusTarget = {
  channel_id: string;
  thread_ts: string;
};

export async function set_slack_assistant_status(
  slack_api: WebClient,
  target: SlackAssistantStatusTarget,
  status = slack_working_status,
  options: { rotate?: boolean } = {},
) {
  const normalized_status = normalize_slack_assistant_status(status);
  const rotate = options.rotate ?? true;
  await slack_api.assistant.threads.setStatus({
    channel_id: target.channel_id,
    thread_ts: target.thread_ts,
    status: normalized_status,
    ...(normalized_status && rotate
      ? { loading_messages: [...slack_working_status_messages] }
      : {}),
  });
}

export async function clear_slack_assistant_status(
  slack_api: WebClient,
  target: SlackAssistantStatusTarget,
) {
  await set_slack_assistant_status(slack_api, target, '');
}

function normalize_slack_assistant_status(status: string) {
  const one_line_status = status.replace(/\s+/g, ' ').trim();
  const status_characters = Array.from(one_line_status);
  if (status_characters.length <= slack_status_max_characters) return one_line_status;

  return `${status_characters
    .slice(0, slack_status_max_characters - 3)
    .join('')
    .trimEnd()}...`;
}
