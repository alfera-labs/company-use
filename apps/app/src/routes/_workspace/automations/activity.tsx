import { createFileRoute } from '@tanstack/react-router';
import { AppContentArea } from '@/components/app/app_content_area';
import { AttentionActivityPage } from '@/components/app/automations/attention_activity_page';
import {
  AutomationsLayout,
  AutomationsLoadingRows,
} from '@/components/app/automations/automations_layout';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/automations/activity')({
  head: () => ({ meta: [{ title: page_title('Activity') }] }),
  component: AttentionActivityRoutePage,
  pendingComponent: () => (
    <AppContentArea>
      <AutomationsLayout current="activity">
        <AutomationsLoadingRows />
      </AutomationsLayout>
    </AppContentArea>
  ),
});

function AttentionActivityRoutePage() {
  return (
    <AppContentArea>
      <AttentionActivityPage />
    </AppContentArea>
  );
}
