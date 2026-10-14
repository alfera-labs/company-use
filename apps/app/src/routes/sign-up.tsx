import { createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { AuthPanel } from '@/components/auth/auth_panel';
import { page_title } from '@/lib/page_title';
import { safe_return_path, workspace_entry_path } from '@/lib/workos_auth_url';
import { read_workos_auth } from '@/lib/workos_session';

const sign_up_search_schema = z.object({
  returnTo: z.string().optional(),
});

const load_sign_up_gate = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await read_workos_auth();
  return { authenticated: Boolean(auth.user) };
});

export const Route = createFileRoute('/sign-up')({
  validateSearch: sign_up_search_schema,
  loaderDeps: ({ search }) => ({ return_to: safe_return_path(search.returnTo) }),
  loader: async ({ deps }) => {
    const gate = await load_sign_up_gate();
    if (gate.authenticated) {
      throw redirect({ href: workspace_entry_path(deps.return_to), reloadDocument: true });
    }
    return gate;
  },
  head: () => ({ meta: [{ title: page_title('Sign up') }] }),
  component: SignUpPage,
});

function SignUpPage() {
  const search = Route.useSearch();
  const return_to = safe_return_path(search.returnTo);

  return <AuthPanel mode="sign-up" return_to={return_to} />;
}
