import { format_chat_text, read_chat_message_text } from '@/components/app/chat_timeline';
import type { RunMessage } from '@/lib/api';

export type ChatPreviewLine = {
  line_id: string;
  role: 'user' | 'assistant';
  text: string;
};

const preview_line_count = 12;

export function chat_preview_lines(messages: RunMessage[]): ChatPreviewLine[] {
  const lines: ChatPreviewLine[] = [];
  for (const message of messages) {
    const line = preview_line_from_message(message);
    if (!line) continue;
    if (line.role === 'assistant' && lines.at(-1)?.role === 'assistant') lines.pop();
    lines.push(line);
  }
  return lines.slice(-preview_line_count);
}

function preview_line_from_message(message: RunMessage): ChatPreviewLine | undefined {
  const role = preview_role(message);
  if (!role) return undefined;
  const text = format_chat_text(read_chat_message_text(message.message_content)).trim();
  if (!text) return undefined;
  return { line_id: message.run_message_id, role, text };
}

function preview_role(message: RunMessage): ChatPreviewLine['role'] | undefined {
  if (message.is_user_visible === false) return undefined;
  if (message.message_role === 'user') return 'user';
  if (message.message_role === 'assistant') return 'assistant';
  return undefined;
}
