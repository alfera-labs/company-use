import { redirect_response } from '@/lib/http_response';
import { read_workos_return_path } from '@/lib/workos_auth_url';
import {
  read_workos_auth,
  refresh_session_with_organization,
  type WorkosAuth,
  type WorkosUser,
} from '@/lib/workos_session';
import {
  get_workspace_invitations_to_offer,
  provision_workos_workspace,
} from '@/lib/workos_workspace_api';

export async function refresh_organization(request: Request) {
  const return_to = read_workos_return_path(request);
  const auth = await read_workos_auth();
  if (!auth.user) {
    const sign_in_url = new URL('/auth/sign-in', request.url);
    sign_in_url.searchParams.set('returnTo', return_to);
    return redirect_response(sign_in_url);
  }

  // Impersonation sessions come from the WorkOS dashboard, are short-lived, and carry the org the
  // admin chose. Do not provision or re-scope them: a session refresh mints a fresh,
  // non-impersonated session and would drop the impersonator, ending the impersonation silently.
  if (auth.impersonator) return redirect_response(new URL(return_to, request.url));

  try {
    return await pin_session_to_provisioned_workspace(
      request,
      { ...auth, user: auth.user },
      return_to,
    );
  } catch (error) {
    console.error('Provisioning the workspace for a sign-in failed', error);
    return workspace_service_unavailable_response(request, return_to);
  }
}

export async function pin_session_to_provisioned_workspace(
  request: Request,
  auth: WorkosAuth & { user: WorkosUser },
  return_to: string,
) {
  if (!auth.organizationId) {
    const invitations = await get_workspace_invitations_to_offer(auth.user);
    if (invitations.length > 0) {
      const invitations_url = new URL('/auth/invitations', request.url);
      invitations_url.searchParams.set('returnTo', return_to);
      return redirect_response(invitations_url);
    }
  }

  const organization = await provision_workos_workspace({
    user: auth.user,
    ...(auth.organizationId ? { organizationId: auth.organizationId } : {}),
  });

  if (!organization.organizationId) {
    throw new Error('Organization provisioning did not return an organization to pin');
  }

  const response = redirect_response(new URL(return_to, request.url));
  if (!auth.organizationId) {
    const set_cookie = await refresh_session_with_organization(organization.organizationId);
    if (set_cookie) response.headers.append('Set-Cookie', set_cookie);
  }
  return response;
}

function workspace_service_unavailable_response(request: Request, return_to: string) {
  const retry_url = new URL(request.url);
  retry_url.searchParams.set('returnTo', return_to);
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Workspace unavailable</title>
  </head>
  <body style="display:grid;place-items:center;min-height:100vh;margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#fdfcfb;color:#131110">
    <div style="text-align:center;max-width:26rem;padding:0 1rem">
      <h1 style="font-size:1rem;font-weight:600;margin:0 0 .5rem">Your workspace didn't answer</h1>
      <p style="font-size:.875rem;color:#7a736c;margin:0 0 1rem">
        You are signed in, but the workspace service could not be reached to finish setting up.
        In local development this usually means the API server or its database is not running.
      </p>
      <a href="${retry_url.pathname}${retry_url.search}" style="font-size:.875rem;font-weight:600;color:#f74e00">Try again</a>
    </div>
  </body>
</html>`;
  return new Response(body, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
