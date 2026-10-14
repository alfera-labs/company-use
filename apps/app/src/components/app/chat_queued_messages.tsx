import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { X } from 'lucide-react';
import { Fragment } from 'react';
import { chat_user_message_class_name, TypedMessageText } from '@/components/app/chat_message';
import type { QueuedSessionMessage } from '@/lib/api';

export type QueuedChatMessage = QueuedSessionMessage & {
  text?: string;
};

type NotSentChatMessage = Extract<QueuedChatMessage, { state: 'not_sent' }>;

const state_labels: Record<QueuedSessionMessage['state'], string> = {
  queued: 'Queued',
  paused: 'Paused',
  not_sent: 'Not sent',
};

export function ChatQueuedMessages({
  messages,
  onRemove,
  onRetry,
  onSendNow,
  isSendingNow,
  retryingJobId,
}: {
  messages: QueuedChatMessage[];
  onRemove: (job_id: string) => void;
  onRetry: (message: NotSentChatMessage) => void;
  onSendNow: () => void;
  isSendingNow: boolean;
  retryingJobId?: string | undefined;
}) {
  if (messages.length === 0) return null;
  const paused_count = messages.filter((message) => message.state === 'paused').length;
  const last_paused = messages.filter((message) => message.state === 'paused').at(-1);

  return (
    <section aria-label="Queued messages" className="flex w-full flex-col items-end gap-3 pb-4">
      {messages.map((message) => (
        <Fragment key={message.job_id}>
          {message.state === 'not_sent' ? (
            <ChatNotSentMessage
              isRetrying={retryingJobId === message.job_id}
              message={message}
              onRemove={onRemove}
              onRetry={onRetry}
            />
          ) : (
            <ChatQueuedMessage message={message} onRemove={onRemove} />
          )}
          {message === last_paused ? (
            <div className="flex items-center gap-2 text-[13px] leading-5 text-muted-foreground">
              <span>{paused_reason_words(paused_count)}</span>
              <Button disabled={isSendingNow} size="sm" type="button" onClick={onSendNow}>
                Send now
              </Button>
            </div>
          ) : null}
        </Fragment>
      ))}
    </section>
  );
}

/** Why the paused messages wait and what sends them, said for one message or for several. */
export function paused_reason_words(paused_count: number) {
  return paused_count === 1
    ? 'This message waits because you stopped the work.'
    : 'These messages wait because you stopped the work.';
}

function ChatQueuedMessage({
  message,
  onRemove,
}: {
  message: QueuedChatMessage;
  onRemove: (job_id: string) => void;
}) {
  if (is_queued_message_starting(message)) {
    return (
      <div className="flex max-w-[78%] min-w-0 flex-col items-end">
        <MessageBubble message={message} />
      </div>
    );
  }
  return (
    <div className="flex max-w-[78%] min-w-0 flex-col items-end gap-1">
      <MessageBubble className="opacity-60" message={message} />
      <div className="flex items-center gap-1.5 pr-1 text-[12px] leading-4 text-muted-foreground">
        <span>{state_labels[message.state]}</span>
        <AttachmentCount count={message.attachment_count} />
        <Button
          aria-label="Remove queued message"
          className="rounded-full"
          size="icon-xs"
          type="button"
          variant="ghost"
          onClick={() => onRemove(message.job_id)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** True when nothing holds the message back: its run starts now. */
export function is_queued_message_starting(message: QueuedChatMessage) {
  return 'waiting_reason' in message && message.waiting_reason === 'starting';
}

function ChatNotSentMessage({
  message,
  isRetrying,
  onRemove,
  onRetry,
}: {
  message: NotSentChatMessage;
  isRetrying: boolean;
  onRemove: (job_id: string) => void;
  onRetry: (message: NotSentChatMessage) => void;
}) {
  return (
    <div className="flex max-w-[78%] min-w-0 flex-col items-end gap-1">
      <MessageBubble message={message} />
      <div className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 pr-1 text-[12px] leading-4 text-muted-foreground">
        <span className="font-medium text-danger-ink">{state_labels.not_sent}</span>
        <span>· {message.reason}</span>
        <AttachmentCount count={message.attachment_count} />
        {message.retry_message ? (
          <Button
            disabled={isRetrying}
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => onRetry(message)}
          >
            {isRetrying ? 'Retrying…' : 'Retry'}
          </Button>
        ) : null}
        <Button
          disabled={isRetrying}
          size="xs"
          type="button"
          variant="ghost"
          onClick={() => onRemove(message.job_id)}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

function MessageBubble({ message, className }: { message: QueuedChatMessage; className?: string }) {
  const text = message.text?.trim() || message.preview_text;
  return (
    <div className={cn(chat_user_message_class_name, className)}>
      <TypedMessageText text={text || 'Attachment'} />
    </div>
  );
}

function AttachmentCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span>
      · {count} attachment{count === 1 ? '' : 's'}
    </span>
  );
}
