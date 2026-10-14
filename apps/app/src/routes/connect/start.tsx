import { createFileRoute } from '@tanstack/react-router';
import { ConnectionSetupStart } from '@/components/app/connection_setup_start';
import { page_title } from '@/lib/page_title';
import { read_public_api_origin } from '@/lib/public_api_origin';

export const Route = createFileRoute('/connect/start')({
  loader: () => read_public_api_origin(),
  staleTime: Number.POSITIVE_INFINITY,
  head: () => ({ meta: [{ title: page_title('Connect integration') }] }),
  component: ConnectionSetupStartPage,
});

function ConnectionSetupStartPage() {
  return <ConnectionSetupStart api_origin={Route.useLoaderData()} />;
}
