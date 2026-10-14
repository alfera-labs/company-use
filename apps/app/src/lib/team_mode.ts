import {
  is_team_mode_switched_on,
  read_team_mode_conflict,
} from '@coworker/config/local_mode_switch';
import { built_in_account } from '@/lib/built_in_account';
import { is_page_before_sign_in } from '@/lib/protected_path';
import { is_write_from_own_page } from '@/lib/same_origin_request';
import { is_static_asset_request } from '@/lib/sandbox_preview_proxy';
import { access_ended_page, sign_in_page_redirect } from '@/lib/team_pages';
import { team_session_ended_header } from '@/lib/team_session_ended';
import { read_team_session } from '@/lib/team_sign_in_api';
import { read_cookie_value, type SessionAuthentication } from '@/lib/workos_session';

export const is_team_mode_on = is_team_mode_switched_on;
export const team_session_cookie_name = 'alfera_team_session';
const join_path_prefix = '/join/';
const words_for_no_session =
  'Sign in with your link. To get one, run ./alfera team link on the machine that runs this Alfera, or ask its owner or an admin for yours.';
const words_for_a_removed_person =
  'Your access to this workspace has ended. Ask its owner or an admin if you need it back.';

type TeamRequestSession = SessionAuthentication & { removed_from_workspace?: string };

/**
 * The name of the session cookie for this request. Over https it carries the `__Host-` prefix,
 * which makes the browser keep it to this exact host and port, Secure, with no Domain. Plain
 * http cannot use that prefix: there the cookie has the plain name, and another web service on
 * the same host name can read it, so plain http is for a trusted network only.
 */
export function team_session_cookie_name_for(request: Request): string {
  return is_https_request(request)
    ? `__Host-${team_session_cookie_name}`
    : team_session_cookie_name;
}

const request_sessions = new WeakMap<Request, Promise<TeamRequestSession>>();

export function read_team_session_token(request: Request): string | undefined {
  return read_cookie_value(request.headers.get('cookie'), team_session_cookie_name_for(request));
}

/**
 * Who the session cookie belongs to. The API is asked once for each request, and on every
 * request, so a person who was removed is out on their next click. `removed_from_workspace`
 * is set for the cookie of a removed person. That cookie is left in the browser: it signs
 * nobody in, and it lets every later request say "your access has ended" until the person
 * opens a new link.
 */
export function authenticate_team_request(request: Request): Promise<TeamRequestSession> {
  const known = request_sessions.get(request);
  if (known) return known;
  const session = find_request_session(request);
  request_sessions.set(request, session);
  return session;
}

async function find_request_session(request: Request): Promise<TeamRequestSession> {
  const session_token = read_team_session_token(request);
  if (!session_token) return { auth: { user: null } };
  const session = await read_team_session(session_token);
  if (!session) {
    return {
      auth: { user: null },
      expired_session_set_cookie: team_session_cookie(request, '', 0),
    };
  }
  if ('removed_from_workspace' in session) {
    return { auth: { user: null }, removed_from_workspace: session.removed_from_workspace };
  }
  const { person } = session;
  return {
    auth: {
      user: built_in_account({ ...person, id: person.user_id }),
      organizationId: person.organization_id,
    },
  };
}

/**
 * The refusal for a request team mode must not serve, or null when the request may go on.
 * A team install is on a network, so nothing is served on trust: every request needs a session
 * except the files of the app itself and the page a sign-in link opens. A request for a page
 * gets a plain page. A request the open app made for data gets a header that tells the app
 * to load the page again, so the person lands on that plain page.
 */
export async function refuse_request_in_team_mode(request: Request): Promise<Response | null> {
  if (!is_team_mode_on()) return null;
  const conflict = read_team_mode_conflict();
  if (conflict) return refuse_a_conflicting_setup(conflict);
  if (is_write(request) && !is_write_from_own_page(request)) {
    return plain_refusal(403, 'Cross-site request refused.');
  }

  const pathname = new URL(request.url).pathname;
  if (is_static_asset_request(pathname)) return null;
  if (pathname.startsWith(join_path_prefix)) return null;
  if (is_page_before_sign_in(pathname)) return null;

  const session = await authenticate_team_request(request);
  if (session.auth.user) return null;
  const refusal = asks_for_a_page(request)
    ? page_for_nobody_signed_in(request, session)
    : answer_for_nobody_signed_in(session);
  if (session.expired_session_set_cookie) {
    refusal.headers.append('Set-Cookie', session.expired_session_set_cookie);
  }
  return refusal;
}

function page_for_nobody_signed_in(request: Request, session: TeamRequestSession): Response {
  return session.removed_from_workspace === undefined
    ? sign_in_page_redirect(request)
    : access_ended_page(session.removed_from_workspace);
}

function answer_for_nobody_signed_in(session: TeamRequestSession): Response {
  const was_removed = session.removed_from_workspace !== undefined;
  return Response.json(
    {
      error: {
        code: was_removed ? 'team_member_removed' : 'unauthorized',
        message: was_removed ? words_for_a_removed_person : words_for_no_session,
      },
    },
    {
      status: 401,
      headers: {
        'Cache-Control': 'no-store',
        'X-Coworker-Auth-Required': '1',
        [team_session_ended_header]: '1',
      },
    },
  );
}

/** HttpOnly and SameSite=Lax always. Secure whenever the browser reached the install over https. */
export function team_session_cookie(
  request: Request,
  session_token: string,
  max_age_seconds: number,
): string {
  const attributes = ['Path=/', `Max-Age=${max_age_seconds}`, 'HttpOnly', 'SameSite=Lax'];
  if (is_https_request(request)) attributes.push('Secure');
  return `${team_session_cookie_name_for(request)}=${session_token}; ${attributes.join('; ')}`;
}

/**
 * The cookie that only says "somebody is signed in" follows the session cookie in team mode:
 * Secure on https, and not on plain http, where a browser would throw a Secure cookie away.
 * In every other install nothing here stands in the way of Secure, as before.
 */
export function hint_may_be_secure(request: Request): boolean {
  return !is_team_mode_on() || is_https_request(request);
}

function is_https_request(request: Request): boolean {
  const forwarded_protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return (forwarded_protocol ?? new URL(request.url).protocol.replace(':', '')) === 'https';
}

const methods_that_change_nothing = new Set(['GET', 'HEAD', 'OPTIONS']);

function is_write(request: Request): boolean {
  return !methods_that_change_nothing.has(request.method);
}

function asks_for_a_page(request: Request): boolean {
  return !is_write(request) && (request.headers.get('accept') ?? '').includes('text/html');
}

const conflict_words_for_a_caller =
  'This install is not set up correctly. The server log says what to change.';

function refuse_a_conflicting_setup(detail_for_the_server_log: string): Response {
  console.error(detail_for_the_server_log);
  return plain_refusal(500, conflict_words_for_a_caller);
}

function plain_refusal(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * In team mode no other site may put a page of this install in a frame, so a click a person
 * means for another page cannot land on a button here. The app frames its own pages (a file
 * preview is one), so the same origin stays allowed.
 */
export function apply_team_mode_frame_headers(response: Response): void {
  if (!is_team_mode_on()) return;
  if (!response.headers.has('Content-Security-Policy')) {
    response.headers.set('Content-Security-Policy', "frame-ancestors 'self'");
  }
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
}
