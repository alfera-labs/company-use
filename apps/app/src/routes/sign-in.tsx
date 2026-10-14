import { createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { AuthPanel } from '@/components/auth/auth_panel';
import { TeamSignIn } from '@/components/install_sign_in/team_sign_in';
import { read_install_sign_in_state } from '@/lib/install_sign_in_api';
import { page_title } from '@/lib/page_title';
import { is_team_mode_on } from '@/lib/team_mode';
import { safe_return_path, workspace_entry_path } from '@/lib/workos_auth_url';
import { has_pending_authentication } from '@/lib/workos_pending_authentication';
import { read_workos_auth } from '@/lib/workos_session';

const sign_in_search_schema = z.object({
  returnTo: z.string().optional(),
  verify: z.string().optional(),
  email: z.string().optional(),
});

const load_sign_in_gate = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await read_workos_auth();
  const team_mode = is_team_mode_on();
  return {
    authenticated: Boolean(auth.user),
    has_pending_authentication: team_mode ? false : await has_pending_authentication(),
    team_sign_in: team_mode ? await read_install_sign_in_state() : null,
  };
});

export const Route = createFileRoute('/sign-in')({
  validateSearch: sign_in_search_schema,
  loaderDeps: ({ search }) => ({ return_to: safe_return_path(search.returnTo) }),
  loader: async ({ deps }) => {
    const gate = await load_sign_in_gate();
    if (gate.authenticated) {
      throw redirect({ href: workspace_entry_path(deps.return_to), reloadDocument: true });
    }
    return gate;
  },
  head: () => ({ meta: [{ title: page_title('Sign in') }] }),
  component: SignInPage,
});

function SignInPage() {
  const search = Route.useSearch();
  const gate = Route.useLoaderData();
  const return_to = safe_return_path(search.returnTo);
  if (gate.team_sign_in) return <TeamSignIn {...gate.team_sign_in} return_to={return_to} />;

  const asks_for_verification =
    search.verify === 'email' &&
    typeof search.email === 'string' &&
    gate.has_pending_authentication;
  const verifying_email = asks_for_verification ? search.email : undefined;

  return (
    <AuthPanel
      mode="sign-in"
      return_to={return_to}
      {...(verifying_email ? { verifying_email } : {})}
    />
  );
}
