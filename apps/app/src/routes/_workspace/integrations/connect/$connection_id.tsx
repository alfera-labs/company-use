import { createFileRoute } from '@tanstack/react-router';
import { AppContentArea } from '@/components/app/app_content_area';
import { AppSignInForm } from '@/components/credentials/app_sign_in_form';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/integrations/connect/$connection_id')({
  head: () => ({ meta: [{ title: page_title('Connect an app') }] }),
  component: ConnectAppRoutePage,
});

function ConnectAppRoutePage() {
  const { connection_id } = Route.useParams();
  return (
    <AppContentArea>
      <div className="mx-auto w-full max-w-md py-10">
        <AppSignInForm connection_id={connection_id} />
      </div>
    </AppContentArea>
  );
}
