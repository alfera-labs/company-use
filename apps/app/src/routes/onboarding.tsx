import '@coworker/ui/onboarding.css';
import { track_meta_event } from '@coworker/ui/lib/meta_pixel';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect } from 'react';
import { z } from 'zod';
import { BrowserTimezoneRecorder } from '@/components/app/browser_timezone_recorder';
import { OnboardingWizard } from '@/components/onboarding/onboarding_wizard';
import { useAuth } from '@/lib/auth_client';
import { is_local_mode_on } from '@/lib/local_mode';
import { get_onboarding_snapshot_on_server } from '@/lib/server_api';
import { is_onboarding_this_persons_job, read_team_arrival } from '@/lib/team_arrival';
import { is_team_mode_on } from '@/lib/team_mode';
import { return_path_after_entry, safe_return_path } from '@/lib/workos_auth_url';
import { read_signed_in_workos_auth } from '@/lib/workos_session';

const onboarding_search_schema = z.object({
  returnTo: z.string().optional(),
});

const load_onboarding = createServerFn({ method: 'GET' }).handler(async () => {
  await read_signed_in_workos_auth();
  const install_signs_its_people_in_itself = is_local_mode_on() || is_team_mode_on();
  if (!is_onboarding_this_persons_job(await read_team_arrival())) {
    return { snapshot: null, follows_theme: install_signs_its_people_in_itself };
  }
  return {
    snapshot: await get_onboarding_snapshot_on_server(),
    follows_theme: install_signs_its_people_in_itself,
  };
});

export const Route = createFileRoute('/onboarding')({
  validateSearch: onboarding_search_schema,
  loaderDeps: ({ search }) => ({ requested_path: safe_return_path(search.returnTo) }),
  loader: async ({ deps }) => {
    const return_to = return_path_after_entry(deps.requested_path);
    const { snapshot, follows_theme } = await load_onboarding();
    if (!snapshot || snapshot.completed) throw redirect({ href: return_to });
    return { snapshot, return_to, follows_theme };
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const { snapshot, return_to, follows_theme } = Route.useLoaderData();
  const { user } = useAuth();
  const user_id = user?.id;

  useEffect(() => {
    if (user_id) track_meta_event('CompleteRegistration', `${user_id}_reg`);
  }, [user_id]);

  return (
    <>
      <BrowserTimezoneRecorder />
      <div data-wizard-follows-theme={follows_theme ? '' : undefined}>
        <OnboardingWizard initialState={snapshot} return_to={return_to} />
      </div>
    </>
  );
}
