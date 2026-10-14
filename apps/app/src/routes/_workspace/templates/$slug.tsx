import { public_brand_config } from '@coworker/config/public_env';
import { TemplateListingView } from '@coworker/ui/components/templates-detail';
import { TemplateListingSkeleton } from '@coworker/ui/components/templates-skeleton';
import { build_templates_hrefs } from '@coworker/ui/lib/templates_hrefs';
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { AppContentArea } from '@/components/app/app_content_area';
import { TemplatesLink } from '@/components/app/templates_link';
import { page_title } from '@/lib/page_title';
import { read_template_listing } from '@/lib/templates_api';
import { read_signed_in_workos_auth } from '@/lib/workos_session';
import { resolve_setup_chat_path } from '@/routes/_workspace/templates/-start_setup_chat';

const load_template_listing = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    await read_signed_in_workos_auth();
    return read_template_listing(data.slug);
  });

export const Route = createFileRoute('/_workspace/templates/$slug')({
  loader: async ({ params }) => {
    const listing = await load_template_listing({ data: { slug: params.slug } });
    if (!listing) throw notFound();
    return listing;
  },
  head: () => ({ meta: [{ title: page_title('Templates') }] }),
  component: TemplateListingRoutePage,
  pendingComponent: TemplateListingLoading,
});

function TemplateListingRoutePage() {
  const listing = Route.useLoaderData();
  const navigate = useNavigate();

  async function start_setup_chat(form_data: FormData) {
    const slug = String(form_data.get('slug') ?? '');
    if (!slug) return;

    const setup_chat_path = await resolve_setup_chat_path({ data: { slug } });
    if (!setup_chat_path) return;

    await navigate({ href: setup_chat_path });
  }

  return (
    <AppContentArea>
      <div className="mx-auto w-full max-w-5xl">
        <TemplateListingView
          listing={listing}
          hrefs={build_templates_hrefs({ base: '/templates', state: {} })}
          brand_name={public_brand_config.product_brand_name}
          link={TemplatesLink}
          install_action={start_setup_chat}
        />
      </div>
    </AppContentArea>
  );
}

function TemplateListingLoading() {
  return (
    <AppContentArea>
      <TemplateListingSkeleton />
    </AppContentArea>
  );
}
