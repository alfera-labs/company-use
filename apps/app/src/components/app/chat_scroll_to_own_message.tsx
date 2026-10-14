import { useEffect } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

/**
 * Brings the reader to the message they just sent. Without it a reader who had scrolled up
 * stays where they were, and their own message lands out of sight.
 */
export function ChatScrollToOwnMessage({ message_id }: { message_id: string | undefined }) {
  const { scrollToBottom } = useStickToBottomContext();
  useEffect(() => {
    if (message_id) void scrollToBottom();
  }, [message_id, scrollToBottom]);
  return null;
}
