import { Skeleton } from '@coworker/ui/components/skeleton';
import { createFileRoute } from '@tanstack/react-router';
import { AppContentArea } from '@/components/app/app_content_area';
import { AutomationNewPage } from '@/components/app/automations/automation_new_page';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/automations/new')({
  head: () => ({ meta: [{ title: page_title('New automation') }] }),
  component: AutomationNewRoutePage,
  pendingComponent: () => (
    <AppContentArea>
      <main className="mx-auto w-full max-w-3xl space-y-4 pb-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </main>
    </AppContentArea>
  ),
});

function AutomationNewRoutePage() {
  return (
    <AppContentArea>
      <AutomationNewPage />
    </AppContentArea>
  );
}
