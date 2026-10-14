import { Skeleton } from '@coworker/ui/components/skeleton';
import { createFileRoute } from '@tanstack/react-router';
import { AppContentArea } from '@/components/app/app_content_area';
import { ApprovalInboxPage } from '@/components/app/approval_inbox_page';
import { InboxNotifications } from '@/components/app/inbox_notifications';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/inbox')({
  head: () => ({ meta: [{ title: page_title('Inbox') }] }),
  component: InboxRoutePage,
  pendingComponent: InboxLoading,
});

function InboxRoutePage() {
  return (
    <AppContentArea>
      <ApprovalInboxPage />
      <InboxNotifications />
    </AppContentArea>
  );
}

function InboxLoading() {
  return (
    <AppContentArea>
      <div className="mx-auto grid w-full max-w-4xl gap-5">
        <Skeleton className="h-16 w-80" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </AppContentArea>
  );
}
