import { read_deploy_page_config } from '@coworker/config/company_use_deploy_env';
import { public_env } from '@coworker/config/public_env';
import { DeployFlow } from '@coworker/ui/components/company_use_deploy/deploy_flow';
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { BrandLogo } from '@/components/app/brand_logo';
import { app_deploy_look } from '@/components/deploy/deploy_look';
import { page_title } from '@/lib/page_title';

const load_deploy_page_config = createServerFn({ method: 'GET' }).handler(() =>
  read_deploy_page_config(public_env.NEXT_PUBLIC_API_URL),
);

export const Route = createFileRoute('/deploy')({
  loader: () => load_deploy_page_config(),
  head: () => ({ meta: [{ title: page_title('Get your own Alfera') }] }),
  component: DeployPage,
});

function DeployPage() {
  const config = Route.useLoaderData();
  return (
    <div className="flex min-h-dvh flex-col bg-[#fafaf8] font-sans text-[#131110] antialiased">
      <main className="mx-auto my-auto flex w-full max-w-[520px] flex-col px-6 py-10">
        <BrandLogo className="h-8 w-auto self-start text-[#131110]" />
        <DeployFlow config={config} look={app_deploy_look} />
      </main>
    </div>
  );
}
