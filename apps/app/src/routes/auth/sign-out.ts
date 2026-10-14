import { createFileRoute } from '@tanstack/react-router';
import { is_same_origin_request } from '@/lib/same_origin_request';
import { sign_out_of_team_mode } from '@/lib/team_join';
import { is_team_mode_on } from '@/lib/team_mode';
import { safe_return_path } from '@/lib/workos_auth_url';
import { build_sign_out_redirect, session_expiry_cookie } from '@/lib/workos_session';

export async function sign_out_response(request: Request) {
  if (is_team_mode_on()) return sign_out_of_team_mode(request);
  if (!is_same_origin_request(request)) {
    return new Response('Sign out only works from this site.', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const url = new URL(request.url);
  const return_path = safe_return_path(url.searchParams.get('returnTo'));
  const return_to = new URL(return_path, url.origin).toString();
  const logout_url = await build_sign_out_redirect(return_to);

  const response = new Response(null, {
    status: 303,
    headers: { Location: logout_url, 'Cache-Control': 'no-store' },
  });
  response.headers.append('Set-Cookie', session_expiry_cookie());
  return response;
}

// Declaring GET only to refuse it: without a handler the router falls through and renders the
// page shell with 200, which reads as "this worked".
export function sign_out_method_not_allowed() {
  return new Response(null, {
    status: 405,
    headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
  });
}

export const Route = createFileRoute('/auth/sign-out')({
  server: {
    handlers: {
      GET: () => sign_out_method_not_allowed(),
      POST: ({ request }) => sign_out_response(request),
    },
  },
});
