import { Skeleton } from '@coworker/ui/components/skeleton';
import { createFileRoute } from '@tanstack/react-router';
import { AppContentArea } from '@/components/app/app_content_area';
import { GoalsPage } from '@/components/app/automations/goals_page';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/automations/goals')({
  head: () => ({ meta: [{ title: page_title('Goals') }] }),
  component: GoalsRoutePage,
  pendingComponent: () => (
    <AppContentArea>
      <main className="mx-auto w-full max-w-3xl space-y-4 pb-10">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
      </main>
    </AppContentArea>
  ),
});

function GoalsRoutePage() {
  return (
    <AppContentArea>
      <GoalsPage />
    </AppContentArea>
  );
}
