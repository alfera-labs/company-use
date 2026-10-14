import { Skeleton } from '@coworker/ui/components/skeleton';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { AppContentArea } from '@/components/app/app_content_area';
import { AutomationDetailPage } from '@/components/app/automations/automation_detail_page';
import { ScheduledAutomationPage } from '@/components/app/automations/scheduled_automation_page';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/automations/$automation_id')({
  head: () => ({ meta: [{ title: page_title('Automation') }] }),
  component: AutomationDetailRoutePage,
  pendingComponent: AutomationDetailLoading,
});

function AutomationDetailRoutePage() {
  const { automation_id } = Route.useParams();
  return (
    <AppContentArea>
      {automation_id.startsWith('trg_') ? (
        <ScheduledAutomationPage triggerId={automation_id} />
      ) : (
        <AutomationDetailPage automationId={automation_id} />
      )}
    </AppContentArea>
  );
}

function AutomationDetailLoading() {
  return (
    <AppContentArea>
      <main className="mx-auto flex w-full max-w-3xl flex-col pb-10">
        <Link
          className="mt-1 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          to="/automations"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Automations
        </Link>
        <div className="mt-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </main>
    </AppContentArea>
  );
}
