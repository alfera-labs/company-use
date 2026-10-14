import {
  type ChatThreadProjectionItem,
  comparable_chat_text,
  read_item_text,
} from '@/components/app/chat_stream_projection';
import { read_chat_message_text } from '@/components/app/chat_timeline';
import type { RunMessage } from '@/lib/api';

/**
 * Drops a live reply that a saved message of the same run already holds. The saved text can be
 * longer: a reader that missed the last live update still holds only the start of the reply, and
 * the transcript would show that start a second time, next to the saved message.
 */
export function live_replies_not_yet_saved(
  live_items: ChatThreadProjectionItem[],
  saved_messages: RunMessage[],
  run_id: string | undefined,
) {
  const saved_texts = saved_messages
    .filter((message) => message.run_id === run_id && message.message_role === 'assistant')
    .map((message) => comparable_chat_text(read_chat_message_text(message.message_content)))
    .filter(Boolean);
  if (saved_texts.length === 0) return live_items;

  const unsaved_items = live_items.filter((item) => {
    if (item.run_id !== run_id) return true;
    const live_text = comparable_chat_text(read_item_text(item));
    return !live_text || !saved_texts.some((saved_text) => saved_text.startsWith(live_text));
  });
  return unsaved_items.length === live_items.length ? live_items : unsaved_items;
}
