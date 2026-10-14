import { public_brand_config } from '@coworker/config/public_env';
import { TemplatesCatalogView } from '@coworker/ui/components/templates-catalog';
import { TemplatesCatalogSkeleton } from '@coworker/ui/components/templates-skeleton';
import { build_templates_hrefs, read_facet } from '@coworker/ui/lib/templates_hrefs';
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { AppContentArea } from '@/components/app/app_content_area';
import { TemplatesLink } from '@/components/app/templates_link';
import { page_title } from '@/lib/page_title';
import { read_template_catalog } from '@/lib/templates_api';
import { read_signed_in_workos_auth } from '@/lib/workos_session';

const catalog_search_schema = z.object({
  q: z.string().optional(),
  kind: z.string().optional(),
  category: z.string().optional(),
  app: z.string().optional(),
  sort: z.string().optional(),
});

const load_template_catalog = createServerFn({ method: 'GET' })
  .validator(catalog_search_schema)
  .handler(async ({ data }) => {
    await read_signed_in_workos_auth();
    const facet = read_facet(data);
    return read_template_catalog({
      ...facet,
      query: data.q,
      kind: data.kind,
      sort: data.sort,
    });
  });

export const Route = createFileRoute('/_workspace/templates/')({
  validateSearch: catalog_search_schema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => load_template_catalog({ data: deps }),
  head: () => ({ meta: [{ title: page_title('Templates') }] }),
  component: TemplatesRoutePage,
  pendingComponent: TemplatesLoading,
});

function TemplatesRoutePage() {
  const catalog = Route.useLoaderData();
  const state = Route.useSearch();
  const navigate = Route.useNavigate();
  const search_templates = (query: string) =>
    void navigate({ to: '/templates', search: { q: query || undefined } });

  if (!catalog) {
    return (
      <AppContentArea>
        <main className="mx-auto flex w-full max-w-5xl flex-col">
          <h1 className="mt-1 text-3xl font-semibold">Templates</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The catalogue is unreachable right now. Reload in a moment.
          </p>
        </main>
      </AppContentArea>
    );
  }

  return (
    <AppContentArea>
      <TemplatesCatalogView
        catalog={catalog}
        hrefs={build_templates_hrefs({ base: '/templates', state })}
        brand_name={public_brand_config.product_brand_name}
        link={TemplatesLink}
        ask_href="/chats"
        on_search={search_templates}
      />
    </AppContentArea>
  );
}

function TemplatesLoading() {
  return (
    <AppContentArea>
      <TemplatesCatalogSkeleton />
    </AppContentArea>
  );
}
