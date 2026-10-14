import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';

export type SessionTitleConversationMessage = {
  role: 'user' | 'assistant';
  text: string;
};

export const session_title_system_prompt = [
  'Write a short title for this work session.',
  'Return only JSON with this shape: {"title":"Three To Eight Words"}.',
  'The title must be 3-8 words, 80 characters or fewer, no quotes, no trailing punctuation.',
].join('\n');

const fallback_title_max_length = 60;

export function build_session_title_messages(
  messages: SessionTitleConversationMessage[],
): RuntimeAgentMessage[] {
  const transcript = messages.slice(0, 6).map(format_title_message).filter(Boolean).join('\n');

  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Conversation:\n${transcript}\n\nReturn the title JSON now.`,
        },
      ],
    },
  ];
}

export function normalize_generated_session_title(value: unknown) {
  if (typeof value !== 'string') return null;
  const title = remove_trailing_punctuation(remove_wrapping_quotes(collapse_spaces(value)));
  if (!is_valid_session_title(title)) return null;
  return title;
}

export function fallback_session_title_from_messages(messages: SessionTitleConversationMessage[]) {
  const user_text = messages.find((message) => message.role === 'user')?.text ?? '';
  const title = cut_at_a_word_boundary(
    text_a_title_can_show(user_text),
    fallback_title_max_length,
  ).replace(/[\s.,'_/-]+$/u, '');

  return title ? `${title.slice(0, 1).toUpperCase()}${title.slice(1)}` : 'New chat';
}

function text_a_title_can_show(text: string) {
  return collapse_spaces(text.replace(/[^\p{L}\p{N}\s.,'_/-]/gu, ' '));
}

function cut_at_a_word_boundary(text: string, max_length: number) {
  if (text.length <= max_length) return text;
  const cut = text.slice(0, max_length + 1);
  const last_space = cut.lastIndexOf(' ');
  return (last_space > 0 ? cut.slice(0, last_space) : text.slice(0, max_length)).trim();
}

function format_title_message(message: SessionTitleConversationMessage) {
  const text = collapse_spaces(message.text);
  return text ? `${message.role}: ${truncate_text(text, 600)}` : '';
}

function is_valid_session_title(title: string) {
  if (!title || title.length > 80) return false;
  if (/["'`]/u.test(title)) return false;
  if (/[.!?:;]$/u.test(title)) return false;

  const word_count = title_words(title).length;
  return word_count >= 3 && word_count <= 8;
}

function title_words(text: string) {
  return collapse_spaces(text)
    .replace(/[^A-Za-z0-9\s-]/g, '')
    .split(' ')
    .filter(Boolean);
}

export function collapse_spaces(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function remove_wrapping_quotes(text: string) {
  return text
    .replace(/^["'`]+/u, '')
    .replace(/["'`]+$/u, '')
    .trim();
}

function remove_trailing_punctuation(text: string) {
  return text.replace(/[.!?:;]+$/u, '').trim();
}

function truncate_text(text: string, max_length: number) {
  if (text.length <= max_length) return text;
  return text.slice(0, max_length).trim();
}
