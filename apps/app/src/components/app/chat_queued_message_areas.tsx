import {
  ChatQueuedMessages,
  is_queued_message_starting,
  type QueuedChatMessage,
} from '@/components/app/chat_queued_messages';
import type { useQueuedChatMessages } from '@/components/app/use_queued_chat_messages';

type QueuedMessageActions = Pick<
  ReturnType<typeof useQueuedChatMessages>,
  'is_sending_now' | 'retrying_job_id' | 'remove' | 'retry' | 'send_now'
>;

/**
 * The two places of the queued messages in a chat. A message that starts now is what the work is
 * about, so it is drawn above "Working". The messages that wait for their turn are drawn below.
 */
export function queued_message_areas(queue: QueuedMessageActions, messages: QueuedChatMessage[]) {
  const draw = (shown: QueuedChatMessage[]) =>
    shown.length === 0 ? null : (
      <ChatQueuedMessages
        isSendingNow={queue.is_sending_now}
        messages={shown}
        retryingJobId={queue.retrying_job_id}
        onRemove={queue.remove}
        onRetry={queue.retry}
        onSendNow={queue.send_now}
      />
    );
  const starting = draw(messages.filter(is_queued_message_starting));
  return {
    startingMessages: starting ? <div className="w-full max-w-3xl px-6">{starting}</div> : null,
    queuedMessages: draw(messages.filter((message) => !is_queued_message_starting(message))),
  };
}
