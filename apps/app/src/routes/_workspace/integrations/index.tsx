import { Skeleton } from '@coworker/ui/components/skeleton';
import { createFileRoute } from '@tanstack/react-router';
import { AppContentArea } from '@/components/app/app_content_area';
import { IntegrationsPage } from '@/components/app/integrations_page';
import {
  CardRowsSkeleton,
  PageLoadingFrame,
  TabStripSkeleton,
} from '@/components/app/page_loading_frame';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/integrations/')({
  head: () => ({ meta: [{ title: page_title('Integrations') }] }),
  component: IntegrationsRoutePage,
  pendingComponent: IntegrationsLoading,
});

function IntegrationsRoutePage() {
  return (
    <AppContentArea>
      <IntegrationsPage />
    </AppContentArea>
  );
}

function IntegrationsLoading() {
  return (
    <PageLoadingFrame title="Integrations" className="max-w-5xl">
      <TabStripSkeleton labels={['Integrations', 'Connected']} />
      <Skeleton className="h-9 w-64 rounded-2xl" />
      <CardRowsSkeleton rows={8} />
    </PageLoadingFrame>
  );
}
