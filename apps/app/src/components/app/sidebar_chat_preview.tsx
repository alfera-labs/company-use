import {
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from '@coworker/ui/components/preview-card';
import { ScrollArea } from '@coworker/ui/components/scroll-area';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { BrandMark } from '@/components/app/brand_mark';
import {
  chat_preview_markdown_class_name,
  chat_preview_streamdown_class_name,
  TypedMessageText,
} from '@/components/app/chat_message';
import { type ChatPreviewLine, chat_preview_lines } from '@/components/app/chat_preview_lines';
import { chat_title } from '@/components/app/chat_title';
import { useHoverAfterAPointerMove } from '@/components/app/use_hover_after_a_pointer_move';
import { MessageContent } from '@/components/prompt-kit/message';
import { list_session_messages, relative_time, type Session } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

const hover_intent_delay_ms = 700;
const hover_close_delay_ms = 250;
const preview_message_limit = 60;

export function SidebarChatPreview({
  children,
  project_label,
  session,
}: {
  children: ReactElement;
  project_label?: string | undefined;
  session: Session;
}) {
  const [is_open, set_is_open] = useState(false);
  const hover = useHoverAfterAPointerMove(() => set_is_open(true), hover_intent_delay_ms);

  return (
    <PreviewCard
      onOpenChange={(open, change) => {
        if (open && change.reason === 'trigger-hover' && hover.refuses_to_open()) change.cancel();
        else set_is_open(open);
      }}
      open={is_open}
    >
      <PreviewCardTrigger
        closeDelay={hover_close_delay_ms}
        delay={hover_intent_delay_ms}
        render={children}
        {...hover.row_props}
      />
      <PreviewCardContent>
        <ChatPreviewBody isOpen={is_open} project_label={project_label} session={session} />
      </PreviewCardContent>
    </PreviewCard>
  );
}

function ChatPreviewBody({
  isOpen,
  project_label,
  session,
}: {
  isOpen: boolean;
  project_label?: string | undefined;
  session: Session;
}) {
  const preview_query = useQuery({
    enabled: isOpen,
    queryKey: query_keys.chat_preview(session.session_id),
    queryFn: () => list_session_messages(session.session_id, { limit: preview_message_limit }),
    staleTime: 30_000,
  });

  const lines = preview_query.data ? chat_preview_lines(preview_query.data.items) : [];

  return (
    <div className="flex flex-col">
      <ChatPreviewHeader project_label={project_label} session={session} />
      {/* The cap goes on the viewport, not the root: the root has no definite height here, so
          a max-height on it would leave the viewport free to grow to its content and spill. */}
      <ScrollArea viewportClassName="max-h-72">
        <div className="flex flex-col gap-1.5 px-1 pb-1">
          {preview_query.isPending ? <ChatPreviewSkeleton /> : null}
          {preview_query.isError ? (
            <ChatPreviewNote>This chat could not be loaded.</ChatPreviewNote>
          ) : null}
          {preview_query.isSuccess && lines.length === 0 ? (
            <ChatPreviewNote>No messages yet.</ChatPreviewNote>
          ) : null}
          {lines.map((line) => (
            <ChatPreviewBubble key={line.line_id} line={line} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function ChatPreviewBubble({ line }: { line: ChatPreviewLine }) {
  if (line.role === 'user') {
    return (
      <div className="ml-6 max-w-[85%] self-end break-words rounded-2xl bg-secondary px-3 py-1.5 text-right text-secondary-foreground">
        <TypedMessageText className="text-[11px] leading-[1.5]" text={line.text} />
      </div>
    );
  }
  return (
    <div className="mr-6 max-w-[92%] self-start break-words rounded-2xl bg-background px-3 py-1.5 text-foreground/90 shadow-xs">
      <MessageContent
        className={chat_preview_markdown_class_name}
        markdown
        streamdownClassName={chat_preview_streamdown_class_name}
      >
        {line.text}
      </MessageContent>
    </div>
  );
}

function ChatPreviewNote({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1 text-[11px] text-muted-foreground">{children}</p>;
}

function ChatPreviewHeader({
  project_label,
  session,
}: {
  project_label?: string | undefined;
  session: Session;
}) {
  const is_running = session.session_status === 'running';
  const last_active =
    session.last_message_time ?? session.last_updated_time ?? session.created_time;

  return (
    <div className="flex items-center gap-2 px-2 pt-1 pb-2">
      <BrandMark className="size-3.5 shrink-0 text-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium leading-snug text-foreground">
          {chat_title(session)}
        </p>
        {project_label ? (
          <p className="truncate text-[11px] leading-4 text-muted-foreground">{project_label}</p>
        ) : null}
      </div>
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
        {is_running ? (
          <>
            <Loader2 aria-hidden="true" className="size-3 animate-spin text-brand-ink" />
            Working
          </>
        ) : (
          relative_time(last_active)
        )}
      </span>
    </div>
  );
}

function ChatPreviewSkeleton() {
  return (
    <div className="flex flex-col gap-1.5" aria-label="Loading preview" role="status">
      <Skeleton className="ml-6 h-7 w-32 self-end rounded-2xl" />
      <Skeleton className="mr-6 h-12 w-full self-start rounded-2xl" />
      <Skeleton className="ml-6 h-7 w-24 self-end rounded-2xl" />
    </div>
  );
}
