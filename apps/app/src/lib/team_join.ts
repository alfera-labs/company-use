import { is_write_from_own_page } from '@/lib/same_origin_request';
import { read_team_session_token, team_session_cookie } from '@/lib/team_mode';
import { join_confirm_page, link_not_valid_page } from '@/lib/team_pages';
import { end_team_session, preview_team_link, redeem_team_link } from '@/lib/team_sign_in_api';

/** Shows who the link is for and one button. Opening it changes nothing, so a chat app's link preview cannot use the link up. */
export async function show_team_join_page(token: string): Promise<Response> {
  const preview = await preview_team_link(token);
  return preview ? join_confirm_page(preview) : link_not_valid_page();
}

/** The button on the join page. This is the one request that uses the link up and starts a session. */
export async function join_team_with_link(request: Request, token: string): Promise<Response> {
  const session = await redeem_team_link(token);
  if (!session) return link_not_valid_page();

  const earlier_session_token = read_team_session_token(request);
  if (earlier_session_token) await end_team_session(earlier_session_token);

  return new Response(null, {
    status: 303,
    headers: {
      Location: '/',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'same-origin',
      'Set-Cookie': team_session_cookie(request, session.session_token, session.max_age_seconds),
    },
  });
}

/** Sign-out ends the session where it is stored, so a copy of the cookie signs nobody in. */
export async function sign_out_of_team_mode(request: Request): Promise<Response> {
  if (!is_write_from_own_page(request)) {
    return new Response('Sign out only works from this site.', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const session_token = read_team_session_token(request);
  if (session_token) await end_team_session(session_token);
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/',
      'Cache-Control': 'no-store',
      'Set-Cookie': team_session_cookie(request, '', 0),
    },
  });
}
