import { Skeleton } from '@coworker/ui/components/skeleton';
import { createFileRoute } from '@tanstack/react-router';
import { AppContentArea } from '@/components/app/app_content_area';
import { AttentionSettings } from '@/components/app/automations/attention_settings';
import { AutomationsLayout } from '@/components/app/automations/automations_layout';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/automations/notifications')({
  head: () => ({ meta: [{ title: page_title('Notifications') }] }),
  component: AutomationsNotificationsRoutePage,
  pendingComponent: () => (
    <AppContentArea>
      <AutomationsLayout current="notifications">
        <Skeleton className="h-64 w-full" />
      </AutomationsLayout>
    </AppContentArea>
  ),
});

function AutomationsNotificationsRoutePage() {
  return (
    <AppContentArea>
      <AutomationsLayout current="notifications">
        <div className="max-w-lg">
          <AttentionSettings />
        </div>
      </AutomationsLayout>
    </AppContentArea>
  );
}
