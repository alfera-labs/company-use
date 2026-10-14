import { cn } from '@coworker/ui/lib/utils';
import { useReducedMotion } from 'motion/react';
import { memo } from 'react';
import { BrandMark } from '@/components/app/brand_mark';
import {
  clock_time_label,
  day_separator_label,
  is_new_day,
} from '@/components/app/chat_message_times';
import { useChatRunRecord } from '@/components/app/chat_run_records';

/** The day label above each message that starts a new day, and nothing above the others. */
export function message_day_labels(messages: readonly { sent_time?: string }[]) {
  const now = Date.now();
  let previous_time: string | undefined;
  return messages.map((message) => {
    if (!is_new_day(previous_time, message.sent_time)) return undefined;
    previous_time = message.sent_time;
    return message.sent_time ? day_separator_label(message.sent_time, now) : undefined;
  });
}

/**
 * One quiet centred line between two days, the way every messenger marks them. The label reads
 * the browser's own clock, so the server cannot render the same words.
 */
export const DaySeparator = memo(function DaySeparator({ label }: { label: string }) {
  return (
    <p className="my-3 self-center text-[12.5px] text-muted-foreground" suppressHydrationWarning>
      {label}
    </p>
  );
});

/** The time a message was sent, shown while the pointer is on the message. */
export function MessageClockTime({ sentTime }: { sentTime?: string | undefined }) {
  const reduce_motion = useReducedMotion();
  if (!sentTime) return null;

  return (
    <time
      className={cn(
        'shrink-0 self-center text-[12.5px] text-muted-foreground opacity-0',
        'group-hover/message:opacity-100 group-focus-within/message:opacity-100',
        !reduce_motion && 'transition-opacity',
      )}
      dateTime={sentTime}
      suppressHydrationWarning
      title={sentTime}
    >
      {clock_time_label(sentTime)}
    </time>
  );
}

/**
 * The name above an answer, with its time beside it. Beside the answer the time took width from
 * the bubble as soon as the answer was saved, so the text wrapped again, and it floated far from
 * the words it dates.
 */
export function AssistantAttribution(props: { name: string; sentTime: string | undefined }) {
  return (
    <div className="mb-1.5 flex items-center gap-2 pl-0.5">
      <span aria-hidden className="grid size-5 place-items-center rounded-[6px] bg-primary">
        <BrandMark className="size-3 text-primary-foreground" />
      </span>
      <span className="text-[14px] leading-5 text-muted-foreground">{props.name}</span>
      <MessageClockTime sentTime={props.sentTime} />
    </div>
  );
}

/**
 * The line under an answer whose run a person stopped. Without it only the sidebar says so.
 * The answers of one run are joined into one message, so the line shows once for a run.
 */
export function StoppedAnswerMark({ run_id }: { run_id: string | undefined }) {
  if (useChatRunRecord(run_id)?.run_status !== 'cancelled') return null;
  return (
    <p className="pl-0.5 text-[13px] leading-5 text-muted-foreground">
      Stopped. Send a message to go on.
    </p>
  );
}
