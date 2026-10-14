import { createFileRoute } from '@tanstack/react-router';
import { AppContentArea } from '@/components/app/app_content_area';
import { ConnectionDetailPage } from '@/components/connections/connection_detail_page';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/integrations/$connection_id')({
  head: () => ({ meta: [{ title: page_title('Connection details') }] }),
  component: ConnectionDetailRoute,
});

function ConnectionDetailRoute() {
  const { connection_id } = Route.useParams();
  return (
    <AppContentArea>
      <ConnectionDetailPage connection_id={connection_id} />
    </AppContentArea>
  );
}
