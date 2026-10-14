import { Skeleton } from '@coworker/ui/components/skeleton';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { peek_chat_route_handoff_text } from '@/components/app/chat_route_handoff';
import { ChatsWorkspace } from '@/components/app/chats_workspace';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/chats/{-$session_id}')({
  head: () => ({ meta: [{ title: page_title('Chats') }] }),
  component: ChatsWorkspace,
  pendingComponent: ChatsLoading,
});

const pending_bubble_class =
  'bg-bubble-mine relative max-w-[78%] rounded-[22px] px-[18px] py-[11px] text-[16px] leading-[1.55] whitespace-pre-wrap';

function ChatsLoading() {
  const [pending_message] = useState(peek_chat_route_handoff_text);

  return (
    <div className="flex h-screen min-h-0 bg-background">
      <section
        aria-label="Loading chat"
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col items-center overflow-hidden"
        role="status"
      >
        <div className="flex w-full max-w-3xl flex-col gap-3 px-6 pt-28 pb-3 lg:pt-16">
          {pending_message ? (
            <div className="flex w-full flex-col items-end">
              <div className={pending_bubble_class}>{pending_message}</div>
            </div>
          ) : (
            <>
              <Skeleton className="h-16 w-2/3 rounded-2xl" />
              <Skeleton className="ml-auto h-16 w-1/2 rounded-2xl" />
              <Skeleton className="h-20 w-3/4 rounded-2xl" />
            </>
          )}
        </div>
        <div className="mt-auto w-full max-w-3xl px-6 pb-6">
          <Skeleton className="h-28 w-full rounded-3xl" />
        </div>
      </section>
    </div>
  );
}
