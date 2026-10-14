import type { QueuedChatMessage } from '@/components/app/chat_queued_messages';
import { read_chat_message_text } from '@/components/app/chat_timeline';
import type { RunMessage } from '@/lib/api';

/** A queued message that failed to start, with the payload to send it again. */
export type NotSentChatMessage = Extract<QueuedChatMessage, { state: 'not_sent' }>;

function read_retry_text(message: NotSentChatMessage) {
  const retry_message = message.retry_message;
  if (!retry_message) return undefined;
  const parts = retry_message.content ?? [];
  return (
    retry_message.message ??
    parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(' ')
  );
}

/** Adds the text the person typed to each queued message, so its bubble shows the words. */
export function with_typed_text(
  queued: QueuedChatMessage[],
  unconfirmed_messages: RunMessage[],
): QueuedChatMessage[] {
  const text_by_client_id = new Map(
    unconfirmed_messages.map((message) => [
      message.run_message_id,
      read_chat_message_text(message.message_content),
    ]),
  );
  return queued.map((message) => {
    const text =
      (message.client_message_id ? text_by_client_id.get(message.client_message_id) : undefined) ??
      (message.state === 'not_sent' ? read_retry_text(message) : undefined);
    return text ? { ...message, text } : message;
  });
}
