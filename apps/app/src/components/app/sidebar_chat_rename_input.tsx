import { cn } from '@coworker/ui/lib/utils';
import { useState } from 'react';

/** The chat name as a text field in the row. Enter saves, Escape and leaving the field cancel. */
export function SidebarChatRenameInput({
  chat_title,
  on_save,
  on_done,
  className,
}: {
  chat_title: string;
  on_save: (typed_name: string) => void;
  on_done: () => void;
  className?: string;
}) {
  const [typed_name, set_typed_name] = useState(chat_title);
  return (
    <form
      className={cn(className, 'bg-[var(--sidebar-selected)]')}
      onSubmit={(event) => {
        event.preventDefault();
        on_save(typed_name);
        on_done();
      }}
    >
      <input
        aria-label={`New name for chat ${chat_title}`}
        // biome-ignore lint/a11y/noAutofocus: the person just chose Rename, so the field is where they type next
        autoFocus
        className="min-w-0 flex-1 bg-transparent text-[13px] leading-4 text-foreground outline-none"
        maxLength={160}
        value={typed_name}
        onBlur={on_done}
        onChange={(event) => set_typed_name(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') on_done();
        }}
      />
    </form>
  );
}
