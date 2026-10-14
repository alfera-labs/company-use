import type { SlackChannelMessage } from '@runtime-platform/channels/slack/channel_routing';
import type { RuntimeToolSourceMetadata } from '@runtime-platform/tools/types';

type ThreadMessage = {
  message_role: string;
  source_metadata?: RuntimeToolSourceMetadata;
  is_user_visible?: boolean;
};

export type SlackThreadAudienceInput = {
  message: SlackChannelMessage;
  stored_messages: ThreadMessage[];
  prior_messages: ThreadMessage[];
};

export function classify_slack_thread_audience(input: SlackThreadAudienceInput) {
  const latest_speaker = slack_message_speaker(input.message).toLocaleLowerCase();
  const other_people = list_human_names(input).filter(
    (name) => name.toLocaleLowerCase() !== latest_speaker,
  );
  return classify_obvious_thread_audience(input.message.text, other_people) ?? 'agent';
}

function classify_obvious_thread_audience(
  message_text: string | undefined,
  other_people: string[],
) {
  const text = message_text?.trim() ?? '';
  if (!text) return null;
  const normalized = text.toLocaleLowerCase();
  const names_agent = /\b(alfera|ai coworker|assistant bot)\b/iu.test(normalized);
  const asks_for_silence = /\b(?:do not|don't|dont|stop)\s+(?:speak|reply|respond|answer)\b/iu.test(
    normalized,
  );
  if (names_agent && asks_for_silence) return 'other' as const;

  if (other_people.some((name) => directly_addresses_person(normalized, name))) {
    return 'other' as const;
  }
  return names_agent ? ('agent' as const) : null;
}

function directly_addresses_person(text: string, person_name: string) {
  const aliases = [person_name, person_name.split(/\s+/u)[0]]
    .filter((name): name is string => Boolean(name))
    .map((name) => escape_regular_expression(name.toLocaleLowerCase()));
  return aliases.some((name) => {
    const starts_with_name = new RegExp(
      `^(?:(?:hey|hi|hello|yo)\\s+)?@?${name}(?:\\s|[,:!?]|$)`,
      'iu',
    );
    const ends_with_name = new RegExp(`,\\s*@?${name}[.!?]*$`, 'iu');
    return starts_with_name.test(text) || ends_with_name.test(text);
  });
}

function escape_regular_expression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function list_human_names(input: SlackThreadAudienceInput) {
  return [
    ...new Set(
      [...input.stored_messages, ...input.prior_messages]
        .filter((message) => message.message_role === 'user' && message.is_user_visible !== false)
        .flatMap(read_human_name),
    ),
  ];
}

function read_human_name(message: ThreadMessage) {
  const profile = message.source_metadata?.source_actor?.profile;
  const name = profile?.display_name ?? profile?.real_name;
  return name ? [name] : [];
}

function slack_message_speaker(message: SlackChannelMessage) {
  return (
    message.user_profile?.display_name ??
    message.user_profile?.real_name ??
    message.user_profile?.username ??
    message.user_id
  );
}
