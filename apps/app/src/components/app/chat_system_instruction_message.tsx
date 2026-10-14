import { cn } from '@coworker/ui/lib/utils';
import { AlarmClock, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { schedule_tool_words } from '@/components/app/automations/schedule_tool_words';
import {
  chat_event_line_class_name,
  chat_markdown_class_name,
  chat_markdown_streamdown_class_name,
  chat_work_pill_class_name,
} from '@/components/app/chat_message';
import type { ProjectedChatMessage } from '@/components/app/chat_stream_projection';
import { Message, MessageContent } from '@/components/prompt-kit/message';

export function SystemInstructionMessage({
  message,
  part_keys,
}: {
  message: ProjectedChatMessage;
  part_keys: readonly string[];
}) {
  const [is_open, set_is_open] = useState(false);

  return (
    <Message className="group flex w-full max-w-3xl flex-col !gap-0 px-6 pt-1.5 pb-3">
      <button
        aria-expanded={is_open}
        className={cn(
          chat_event_line_class_name,
          'cursor-pointer transition-colors hover:text-foreground',
        )}
        type="button"
        onClick={() => set_is_open(!is_open)}
      >
        <AlarmClock aria-hidden="true" className="size-[14px] shrink-0" />
        <span className="min-w-0 truncate">{schedule_tool_words.ran_its_instructions}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-[13px] shrink-0 transition-transform duration-300',
            is_open ? 'rotate-0' : '-rotate-90',
          )}
        />
      </button>
      {is_open ? (
        <div className={cn(chat_work_pill_class_name, 'mt-2 self-start')}>
          {message.parts.map((part, index) =>
            part.type === 'text' ? (
              <MessageContent
                className={chat_markdown_class_name}
                key={part_keys[index]}
                markdown
                streamdownClassName={chat_markdown_streamdown_class_name}
              >
                {part.text}
              </MessageContent>
            ) : null,
          )}
        </div>
      ) : null}
    </Message>
  );
}
