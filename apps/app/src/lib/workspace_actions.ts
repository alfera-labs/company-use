import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
import { z } from 'zod';
import { read_workos_auth, refresh_session_with_organization } from '@/lib/workos_session';
import {
  create_personal_workos_workspace,
  create_workos_workspace,
  set_active_workspace,
} from '@/lib/workos_workspace_api';

// Make an organization the active workspace. Refreshing the session pinned to the org re-scopes
// the session cookie and throws if the user is not a member, so this is safe to call with any org
// id from the switcher. The API records the durable last-active; the session cookie is the fast path.
export const switch_workspace = createServerFn({ method: 'POST' })
  .validator(z.string())
  .handler(async ({ data: organization_id }) => {
    const auth = await read_workos_auth();
    if (!auth.user) throw new Error('Sign in to switch workspaces');

    await pin_session_to_organization(organization_id);
    await set_active_workspace({ providerUserId: auth.user.id, organizationId: organization_id });
  });

export const create_personal_workspace = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await read_workos_auth();
  if (!auth.user) throw new Error('Sign in to create a workspace');

  const { organizationId } = await create_personal_workos_workspace(auth.user);
  await pin_session_to_organization(organizationId);
  return { organizationId };
});

export const create_workspace = createServerFn({ method: 'POST' })
  .validator(z.string().min(1))
  .handler(async ({ data: name }) => {
    const auth = await read_workos_auth();
    if (!auth.user) throw new Error('Sign in to create a workspace');

    const { organizationId } = await create_workos_workspace({ user: auth.user, name });
    await pin_session_to_organization(organizationId);
    return { organizationId };
  });

async function pin_session_to_organization(organization_id: string) {
  const set_cookie = await refresh_session_with_organization(organization_id);
  if (!set_cookie) throw new Error('No live session to pin to the organization');
  setResponseHeader('Set-Cookie', set_cookie);
}
