import { cn } from '@coworker/ui/lib/utils';
import { ChatStreamingIndicator } from '@/components/app/chat_streaming_indicator';
import { remove_message_text_file_note } from '@/components/app/message_text_file_note';

/**
 * The text of an answer. A table keeps its own display: as a block its rows are only as wide as
 * their text, and the row lines stop short of the table box, which already scrolls a wide table.
 */
export const chat_markdown_class_name = cn(
  'relative min-w-full bg-transparent p-0 text-[15px] leading-[1.6]',
  '[&_strong]:font-medium',
);

export const chat_markdown_streamdown_class_name = cn(
  'text-[15px] leading-[1.6] [&]:!gap-2',
  '[&_p]:leading-[1.6] [&_li]:leading-[1.6]',
  '[&_ol]:space-y-1.5 [&_ul]:space-y-1.5',
);

export const chat_assistant_bubble_class_name =
  'w-fit max-w-[88%] rounded-[22px] bg-raised px-[20px] py-[13px] shadow-raised ring-1 ring-border/60 empty:hidden';

export const chat_work_pill_class_name =
  'w-fit max-w-full rounded-[20px] bg-raised px-[16px] py-[8px] shadow-raised ring-1 ring-border/60';

export const chat_event_line_class_name =
  'flex w-fit max-w-full items-center gap-1.5 self-center text-[13.5px] leading-5 text-muted-foreground';

export const chat_reasoning_class_name = cn(
  'bg-transparent p-0 text-[13px] leading-5 text-muted-foreground',
  '[&_table]:block [&_table]:overflow-y-auto [&_strong]:font-medium',
);

export const chat_reasoning_streamdown_class_name = cn(
  'text-[13px] leading-5 [&]:!gap-1.5',
  '[&_p]:leading-5 [&_li]:leading-5',
  '[&_ol]:space-y-1 [&_ul]:space-y-1',
  '[&_code]:text-[12px]',
);

export const chat_preview_markdown_class_name = cn(
  'min-w-0 bg-transparent p-0 text-[11px] leading-[1.5]',
  '[&_table]:block [&_table]:overflow-x-auto [&_strong]:font-medium',
);

export const chat_preview_streamdown_class_name = cn(
  'text-[11px] leading-[1.5] [&]:!gap-1.5',
  '[&_p]:leading-[1.5] [&_li]:leading-[1.5]',
  '[&_ol]:space-y-1 [&_ul]:space-y-1 [&_ol]:pl-4 [&_ul]:pl-4',
  '[&_h1]:text-[11px] [&_h2]:text-[11px] [&_h3]:text-[11px] [&_h4]:text-[11px]',
  '[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold',
  '[&_code]:text-[10px] [&_pre]:overflow-x-auto [&_pre]:p-2 [&_pre]:text-[10px]',
  '[&_img]:max-h-24 [&_img]:w-auto [&_img]:rounded-2xl',
);

export const chat_user_message_class_name = cn(
  'bg-bubble-mine relative max-w-full rounded-[22px] px-[18px] py-[11px] text-[15px] leading-[1.55]',
  '[&_p]:m-0 [&_p]:text-[15px] [&_p]:leading-[1.55] [&_ol]:m-0 [&_ul]:m-0 [&_li]:m-0',
);

/**
 * The person's own text, shown as they typed it. It is never read as markdown or HTML:
 * `List<String>`, `</dev/tcp/x` and `2 * 3 * 4` must come back character for character.
 */
export function TypedMessageText({ className, text }: { className?: string; text: string }) {
  return (
    <p className={cn('min-w-0 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere]', className)}>
      {remove_message_text_file_note(text)}
    </p>
  );
}

export function AssistantLoadingBubble({ label }: { label?: string }) {
  return (
    <div aria-live="polite" role="status" className="inline-flex h-6 w-fit items-center">
      <ChatStreamingIndicator {...(label ? { label } : {})} />
    </div>
  );
}
