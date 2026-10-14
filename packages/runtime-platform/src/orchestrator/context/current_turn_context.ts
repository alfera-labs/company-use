import {
  recurring_work_rail,
  what_calls_for_an_outward_channel,
} from '@runtime-platform/automations/recurring_work_prompt';
import {
  format_current_email_context,
  type SessionCurrentEmailContext,
} from '@runtime-platform/orchestrator/context/email_turn_context';
import {
  format_current_headless_context,
  type SessionCurrentHeadlessContext,
  wall_clock_rule,
} from '@runtime-platform/orchestrator/context/headless_turn_context';

export type { SessionCurrentHeadlessContext };

export type SessionCurrentTurnContext = { chat_url?: string } & (
  | { source_type: 'slack'; slack: SessionCurrentSlackContext }
  | { source_type: 'email'; email: SessionCurrentEmailContext }
  | { source_type: 'web_chat'; web_chat: SessionCurrentWebChatContext }
  | { source_type: 'api'; api: SessionCurrentApiContext }
  | { source_type: 'headless'; headless: SessionCurrentHeadlessContext }
);

type SessionCurrentApiContext = {
  speaker_name?: string;
};

export type SessionCurrentWebChatContext = {
  speaker_name?: string;
  speaker_email?: string;
  speaker_local_time?: string;
  workspace_name?: string;
};

export type SessionCurrentSlackContext = {
  team_id?: string;
  channel_id?: string;
  channel_type?: string;
  configured_channel_id?: string;
  conversation_scope?: string;
  addressing_mode?:
    | 'direct_message'
    | 'explicit_mention'
    | 'thread_continuation'
    | 'channel_message';
  event_ts?: string;
  thread_ts?: string;
  speaker_user_id?: string;
  speaker_name?: string;
  speaker_email?: string;
  speaker_local_time?: string;
};

export function format_current_turn_context(context?: SessionCurrentTurnContext) {
  if (!context) return null;
  const block = format_current_turn_source(context);
  if (!block) return null;
  return [
    block,
    format_chat_link(context.chat_url),
    human_turn_source_types.has(context.source_type) ? recurring_work_rail : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

const human_turn_source_types = new Set<SessionCurrentTurnContext['source_type']>([
  'slack',
  'email',
  'web_chat',
]);

function format_current_turn_source(context: SessionCurrentTurnContext) {
  if (context.source_type === 'slack') return format_current_slack_context(context.slack);
  if (context.source_type === 'email') return format_current_email_context(context.email);
  if (context.source_type === 'web_chat') return format_current_web_chat_context(context.web_chat);
  if (context.source_type === 'api') return format_current_api_context(context.api);
  if (context.source_type === 'headless') return format_current_headless_context(context.headless);
  return null;
}

function format_chat_link(chat_url?: string) {
  if (!chat_url) return null;
  return [
    `this_chat: ${chat_url}`,
    'This conversation has its own page. When you reach this person somewhere else — email, Slack — and you need them to approve, decide, or answer, link them to this page and ask them to reply here.',
    'This replaces any approval channel of your own making, including one a saved task instruction of yours describes: never send a mailto link, never ask someone to send an email whose subject line you wrote for them, and never detect their answer by searching their mail. If a saved instruction tells you to, link to this page instead and tell them you changed it.',
  ].join('\n');
}

function format_current_api_context(api: SessionCurrentApiContext) {
  const lines = ['source: a question asked through the public API'];
  if (api.speaker_name) {
    lines.push(`asked_by: ${api.speaker_name}`);
    lines.push(
      'This is the person waiting on you. They may be outside this workspace, so answer as the company would answer a customer.',
    );
  }
  lines.push(
    'Your reply is returned as the answer to this one request and is the only thing they receive. Nothing you write reaches Slack, email, or any other channel from here, so put the whole answer in this reply.',
  );
  lines.push(
    'Do not promise to send, post, share, or follow up later, and do not say you are about to look something up: this run ends with your answer.',
  );
  return lines.join('\n');
}

function format_current_web_chat_context(web_chat: SessionCurrentWebChatContext) {
  const lines = ['source: web chat (dashboard)'];
  if (web_chat.workspace_name) lines.push(`workspace: ${web_chat.workspace_name}`);
  if (web_chat.speaker_name || web_chat.speaker_email) {
    const identity = [
      web_chat.speaker_name,
      web_chat.speaker_email ? `<${web_chat.speaker_email}>` : undefined,
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`speaking_with: ${identity}`);
    lines.push(
      'This is the person talking to you right now. Address them by name when natural, and answer identity questions ("who am I") from this plus their memory facts.',
    );
  }
  append_speaker_local_time(lines, web_chat.speaker_local_time);
  lines.push(
    `Your reply is delivered here, in this web chat, and streamed back to this person. You have every tool available; reach an outward channel (Slack, email) when ${what_calls_for_an_outward_channel} calls for it, and not on the strength of a memory alone.`,
  );
  return lines.join('\n');
}

function format_current_slack_context(slack: SessionCurrentSlackContext) {
  const lines = [`source: Slack — ${describe_slack_inbound(slack)}`];
  if (slack.speaker_name || slack.speaker_user_id) {
    const identity = [
      slack.speaker_name,
      slack.speaker_email ? `<${slack.speaker_email}>` : undefined,
      slack.speaker_user_id ? `(Slack ${slack.speaker_user_id})` : undefined,
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`speaking_with: ${identity}`);
    lines.push(
      'This is the person talking to you right now. Address them by name when natural, and answer identity questions ("who am I") from this plus their memory facts.',
    );
  }
  append_speaker_local_time(lines, slack.speaker_local_time);
  append_field(lines, 'team_id', slack.team_id);
  append_field(lines, 'channel_id', slack.channel_id);
  append_field(lines, 'channel_type', slack.channel_type);
  append_field(lines, 'configured_channel_id', slack.configured_channel_id);
  append_field(lines, 'conversation_scope', slack.conversation_scope);
  append_field(lines, 'addressing_mode', slack.addressing_mode);
  append_field(lines, 'thread_ts', slack.thread_ts);
  append_field(lines, 'event_ts', slack.event_ts);
  lines.push(
    'Use these values when the user says "here", "this chat", "this channel", or "this thread", especially for Slack replies and file uploads.',
  );
  lines.push(
    'Write anything you send to Slack in standard Markdown ([label](https://example.com), **bold**); the platform converts it to Slack formatting for you.',
  );
  return lines.join('\n');
}

function describe_slack_inbound(slack: SessionCurrentSlackContext) {
  if (slack.addressing_mode === 'thread_continuation') {
    return 'a person just posted in a shared Slack thread where you previously participated. The message may be for you or for another human; decide from the latest message before acting';
  }

  const opening =
    slack.conversation_scope === 'dm'
      ? 'a person just sent you a direct message in Slack'
      : slack.conversation_scope === 'group'
        ? 'a person just sent you a message in a Slack group DM'
        : slack.conversation_scope === 'thread'
          ? 'a person just sent you a message in a Slack thread'
          : 'a person just sent you a message in a Slack channel';
  return `${opening}. The message is addressed to you and your reply belongs in this Slack conversation.`;
}

function append_speaker_local_time(lines: string[], speaker_local_time: string | undefined) {
  if (!speaker_local_time) return;
  lines.push(`speaker_local_time: ${speaker_local_time}`);
  lines.push(wall_clock_rule);
}

function append_field(lines: string[], label: string, value: string | undefined) {
  if (value) lines.push(`${label}: ${value}`);
}
