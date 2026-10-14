import { Skeleton } from '@coworker/ui/components/skeleton';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { AppContentArea } from '@/components/app/app_content_area';
import { SettingsSectionView } from '@/components/app/settings_section_view';
import { is_local_mode_on } from '@/lib/local_mode';
import { page_title } from '@/lib/page_title';
import { find_settings_section } from '@/lib/settings_navigation';
import {
  build_settings_widget_tokens,
  type SettingsWidgetTokens,
} from '@/lib/settings_widget_tokens';
import { is_team_mode_on } from '@/lib/team_mode';
import { read_workos_auth } from '@/lib/workos_session';

const settings_search_schema = z.object({ add_key: z.string().optional().catch(undefined) });

const load_settings_widget_tokens = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SettingsWidgetTokens | null> => {
    const auth = await read_workos_auth();
    if (auth.user && !auth.organizationId) return null;
    return {
      ...build_settings_widget_tokens(auth),
      runs_in_local_mode: is_local_mode_on(),
      runs_in_team_mode: is_team_mode_on(),
    };
  },
);

export const Route = createFileRoute('/_workspace/settings/{-$section}')({
  validateSearch: settings_search_schema,
  loader: async () => {
    const tokens = await load_settings_widget_tokens();
    if (!tokens) {
      throw redirect({
        href: '/auth/organization/refresh?returnTo=/settings',
        reloadDocument: true,
      });
    }
    return tokens;
  },
  head: ({ params }) => ({
    meta: [{ title: page_title(`${find_settings_section(params.section).title} · Settings`) }],
  }),
  component: SettingsRoutePage,
  pendingComponent: SettingsLoading,
});

function SettingsRoutePage() {
  const { section } = Route.useParams();
  const context = Route.useLoaderData();

  return (
    <AppContentArea>
      <SettingsSectionView
        section_id={find_settings_section(section).section_id}
        context={context}
      />
    </AppContentArea>
  );
}

function SettingsLoading() {
  return (
    <AppContentArea>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-10">
        <header className="mt-1 flex flex-col gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80" />
        </header>
        <Skeleton className="h-64 w-full rounded-3xl" />
      </main>
    </AppContentArea>
  );
}
