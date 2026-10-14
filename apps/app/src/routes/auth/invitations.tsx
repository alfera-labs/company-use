import '@coworker/ui/onboarding.css';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { WorkspaceInvitationChoice } from '@/components/auth/workspace_invitation_choice';
import { page_title } from '@/lib/page_title';
import { safe_return_path, workspace_entry_path } from '@/lib/workos_auth_url';
import { read_workos_auth } from '@/lib/workos_session';
import { get_workspace_invitations_to_offer } from '@/lib/workos_workspace_api';

const invitations_search_schema = z.object({
  returnTo: z.string().optional(),
});

const load_workspace_invitations = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await read_workos_auth();
  if (!auth.user) return null;
  return get_workspace_invitations_to_offer(auth.user);
});

export const Route = createFileRoute('/auth/invitations')({
  validateSearch: invitations_search_schema,
  loaderDeps: ({ search }) => ({ return_to: safe_return_path(search.returnTo) }),
  loader: async ({ deps }) => {
    const invitations = await load_workspace_invitations();
    if (!invitations) {
      throw redirect({
        href: `/auth/sign-in?returnTo=${encodeURIComponent(deps.return_to)}`,
        reloadDocument: true,
      });
    }

    if (invitations.length === 0) {
      throw redirect({ href: workspace_entry_path(deps.return_to), reloadDocument: true });
    }

    return invitations;
  },
  head: () => ({ meta: [{ title: page_title('Join your team') }] }),
  component: WorkspaceInvitationsPage,
});

function WorkspaceInvitationsPage() {
  const search = Route.useSearch();
  const invitations = Route.useLoaderData();

  return (
    <WorkspaceInvitationChoice
      invitations={invitations}
      return_to={safe_return_path(search.returnTo)}
    />
  );
}
