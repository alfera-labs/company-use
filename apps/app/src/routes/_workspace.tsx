import { Button } from '@coworker/ui/components/button';
import * as Sentry from '@sentry/tanstackstart-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createFileRoute,
  type ErrorComponentProps,
  Link,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { AppContentArea } from '@/components/app/app_content_area';
import { AppShell } from '@/components/app/app_shell';
import { ImpersonationBanner } from '@/components/app/impersonation_banner';
import { TeamSignInNoticeToast } from '@/components/app/team_sign_in_notice_toast';
import { query_keys } from '@/lib/api/query_keys';
import { team_viewer_role_query_key } from '@/lib/api/team_mode';
import type { Workspace } from '@/lib/api/types';
import { is_local_mode_on } from '@/lib/local_mode';
import { is_onboarding_required_for_app } from '@/lib/onboarding_gate';
import { get_workspace_on_server } from '@/lib/server_api';
import {
  is_onboarding_this_persons_job,
  read_team_arrival,
  type TeamArrival,
} from '@/lib/team_arrival';
import { is_team_mode_on } from '@/lib/team_mode';
import {
  return_path_after_entry,
  safe_return_path,
  workspace_entry_path,
} from '@/lib/workos_auth_url';
import { read_workos_auth } from '@/lib/workos_session';

type WorkspaceGate = {
  workspace: Workspace | null;
  impersonator: { email: string; reason: string | null } | null;
  user_email: string | null;
  team_arrival: TeamArrival;
  can_make_workspaces: boolean;
};

const load_workspace_gate = createServerFn({ method: 'GET' })
  .validator(z.object({ requested_path: z.string() }))
  .handler(async ({ data }): Promise<WorkspaceGate> => {
    const auth = await read_workos_auth();
    const requested_path = safe_return_path(data.requested_path);
    const return_to = return_path_after_entry(requested_path);

    // Impersonation sessions are exempt from the org chokepoint: the refresh route calls a session
    // refresh, which would mint a non-impersonated session and drop the impersonator. WorkOS
    // impersonation already carries the org the admin chose, so an impersonated session should
    // never be org-less here anyway.
    if (auth.user && !auth.organizationId && !auth.impersonator) {
      throw redirect({ href: workspace_entry_path(return_to), reloadDocument: true });
    }

    const [workspace, team_arrival] = await Promise.all([
      get_workspace_on_server(),
      read_team_arrival(),
    ]);
    if (is_onboarding_required_for_app(workspace) && is_onboarding_this_persons_job(team_arrival)) {
      throw redirect({
        href:
          return_to === '/'
            ? '/onboarding'
            : `/onboarding?returnTo=${encodeURIComponent(return_to)}`,
      });
    }

    return {
      workspace,
      impersonator: auth.impersonator
        ? { email: auth.impersonator.email, reason: auth.impersonator.reason ?? null }
        : null,
      user_email: auth.user?.email ?? null,
      team_arrival,
      can_make_workspaces: !is_local_mode_on() && !is_team_mode_on(),
    };
  });

export const Route = createFileRoute('/_workspace')({
  loader: ({ location }) =>
    load_workspace_gate({ data: { requested_path: `${location.pathname}${location.searchStr}` } }),
  staleTime: Number.POSITIVE_INFINITY,
  component: WorkspaceLayout,
  errorComponent: AppSurfaceError,
  notFoundComponent: AppNotFound,
});

function WorkspaceLayout() {
  const gate = Route.useLoaderData();
  const query_client = useQueryClient();

  useState(() => {
    if (gate.workspace) query_client.setQueryData(query_keys.workspace(), gate.workspace);
    query_client.setQueryDefaults(team_viewer_role_query_key, { gcTime: Number.POSITIVE_INFINITY });
    query_client.setQueryData(team_viewer_role_query_key, gate.team_arrival.viewer_role);
  });

  const banner = gate.impersonator ? (
    <ImpersonationBanner
      impersonator_email={gate.impersonator.email}
      subject_email={gate.user_email ?? undefined}
      reason={gate.impersonator.reason ?? undefined}
    />
  ) : undefined;

  return (
    <AppShell banner={banner} can_make_workspaces={gate.can_make_workspaces}>
      <TeamSignInNoticeToast arrival={gate.team_arrival} />
      <Outlet />
    </AppShell>
  );
}

function AppSurfaceError({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <AppContentArea>
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">This page didn't load.</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </AppContentArea>
  );
}

function AppNotFound() {
  return (
    <AppContentArea>
      <div className="grid min-h-[420px] place-items-center text-center">
        <div className="space-y-2">
          <h2 className="text-base font-medium">Page not found</h2>
          <p className="text-sm text-muted-foreground">
            That page doesn’t exist.{' '}
            <Link to="/" className="text-foreground underline underline-offset-4">
              Back to home
            </Link>
          </p>
        </div>
      </div>
    </AppContentArea>
  );
}
