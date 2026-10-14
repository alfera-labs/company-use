import { createFileRoute } from '@tanstack/react-router';
import { AppContentArea } from '@/components/app/app_content_area';
import {
  AutomationsLayout,
  AutomationsLoadingRows,
} from '@/components/app/automations/automations_layout';
import { AutomationsPage } from '@/components/app/automations/automations_page';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/automations/')({
  head: () => ({ meta: [{ title: page_title('Automations') }] }),
  component: AutomationsRoutePage,
  pendingComponent: AutomationsLoading,
});

function AutomationsRoutePage() {
  return (
    <AppContentArea>
      <AutomationsPage />
    </AppContentArea>
  );
}

function AutomationsLoading() {
  return (
    <AppContentArea>
      <AutomationsLayout current="automations">
        <AutomationsLoadingRows />
      </AutomationsLayout>
    </AppContentArea>
  );
}
