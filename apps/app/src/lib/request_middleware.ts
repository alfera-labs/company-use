import { sandbox_preview_base_domain } from '@coworker/config/hosted_defaults';
import * as Sentry from '@sentry/tanstackstart-react';
import { createMiddleware } from '@tanstack/react-start';
import {
  auth_hint_cookie_domain,
  parent_domain_session_cookie_expiries,
} from '@/lib/auth_cookie_scope';
import { authenticate_request, refuse_request_in_its_sign_in_mode } from '@/lib/local_mode';
import { is_protected_path } from '@/lib/protected_path';
import { is_sandbox_preview_host, is_static_asset_request } from '@/lib/sandbox_preview_proxy';
import { proxy_sandbox_preview } from '@/lib/sandbox_preview_upstream';
import { apply_team_mode_frame_headers, hint_may_be_secure } from '@/lib/team_mode';
import { prime_request_auth, type SessionAuthentication } from '@/lib/workos_session';

const auth_hint_cookie = 'alfera_authed';
const robots_header_name = 'X-Robots-Tag';
const auth_required_header_name = 'X-Coworker-Auth-Required';
const app_robots_directive = 'noindex, nofollow';
const sentry_tunnel_path = '/monitoring';

export const app_request_middleware = createMiddleware({ type: 'request' }).server(
  async ({ request, next, handlerType }) => {
    const url = new URL(request.url);

    const sign_in_mode_refusal = await refuse_request_in_its_sign_in_mode(request);
    if (sign_in_mode_refusal) return sign_in_mode_refusal;

    if (handlerType === 'serverFn') {
      const session = await authenticate_request(request);
      prime_request_auth(request, session);
      try {
        const result = await next();
        finish_response(result.response, request, session, Boolean(session.auth.user));
        return result;
      } catch (error) {
        return answer_after_handler_failure(error, request, session, Boolean(session.auth.user));
      }
    }

    if (is_sandbox_preview_request(request)) {
      const response = await proxy_sandbox_preview(request);
      apply_robots_header(response);
      return response;
    }

    if (is_static_asset_request(url.pathname)) {
      const result = await next();
      apply_robots_header(result.response);
      return result;
    }

    // The Sentry tunnel. The browser posts an error report to it, so unsealing the session first
    // costs a WorkOS round trip on every report and can itself fail when the session is the thing
    // that broke. The gate already exempts the path, so nothing here is authenticated anyway.
    // Hands off the response too: Sentry's handler forwards the envelope with fetch() and returns
    // that upstream Response, whose headers are immutable — setting anything on it throws and
    // turns delivered telemetry into a 500. A robots header means nothing on a telemetry POST.
    if (url.pathname === sentry_tunnel_path) {
      return next();
    }

    const session = await authenticate_request(request);
    prime_request_auth(request, session);
    const is_authenticated = Boolean(session.auth.user);

    if (is_protected_path(url.pathname) && !is_authenticated) {
      if (!is_document_navigation_request(request)) {
        const response = new Response(null, { status: 401 });
        response.headers.set('Cache-Control', 'no-store');
        response.headers.set(auth_required_header_name, '1');
        return finish_response(response, request, session, false);
      }

      const sign_in_url = new URL(request.url);
      sign_in_url.pathname = '/sign-in';
      const return_to = `${url.pathname}${url.search}`;
      sign_in_url.search = '';
      sign_in_url.searchParams.set('returnTo', return_to);
      const redirect = new Response(null, {
        status: 307,
        headers: { Location: sign_in_url.toString() },
      });
      return finish_response(redirect, request, session, false);
    }

    try {
      const result = await next();
      finish_response(result.response, request, session, is_authenticated);
      return result;
    } catch (error) {
      return answer_after_handler_failure(error, request, session, is_authenticated);
    }
  },
);

// A handler that throws takes the rotated session cookie with it: TanStack rethrows, the framework
// builds its own error response, and the browser keeps a refresh token this request already spent.
// The next request then signs the person out. So when a rotation is waiting, answer the error here
// and carry the cookie on that answer.
function answer_after_handler_failure(
  error: unknown,
  request: Request,
  session: SessionAuthentication,
  is_authenticated: boolean,
) {
  if (request.signal.aborted) throw error;
  if (!session.rotated_session_set_cookie) throw error;

  Sentry.captureException(error, { mechanism: { handled: false } });
  const response = Response.json(
    { error: { code: 'internal_error', message: 'An unexpected error occurred' } },
    { status: 500 },
  );
  return finish_response(response, request, session, is_authenticated);
}

function finish_response(
  response: Response,
  request: Request,
  session: SessionAuthentication,
  is_authenticated: boolean,
): Response {
  const session_cookie = session.rotated_session_set_cookie ?? session.expired_session_set_cookie;
  if (session_cookie) response.headers.append('Set-Cookie', session_cookie);
  apply_auth_hint(request, response, is_authenticated);
  expire_parent_domain_session_cookies(request, response);
  apply_robots_header(response);
  apply_team_mode_frame_headers(response);
  return response;
}

function apply_auth_hint(request: Request, response: Response, is_authenticated: boolean) {
  const domain = auth_hint_cookie_domain();
  const parts = [
    `${auth_hint_cookie}=${is_authenticated ? '1' : ''}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${is_authenticated ? 60 * 60 * 24 * 30 : 0}`,
  ];
  if (domain) parts.push(`Domain=${domain}`);
  if (process.env.NODE_ENV === 'production' && hint_may_be_secure(request)) parts.push('Secure');
  response.headers.append('Set-Cookie', parts.join('; '));
}

function expire_parent_domain_session_cookies(request: Request, response: Response) {
  const cookie_names = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((pair) => pair.trim().split('=')[0])
    .filter((name): name is string => Boolean(name));
  for (const set_cookie of parent_domain_session_cookie_expiries(cookie_names)) {
    response.headers.append('Set-Cookie', set_cookie);
  }
}

function apply_robots_header(response: Response) {
  response.headers.set(robots_header_name, app_robots_directive);
}

function is_document_navigation_request(request: Request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (is_prefetch_request(request.headers)) return false;

  const destination = request.headers.get('sec-fetch-dest');
  if (destination) return destination === 'document';

  const mode = request.headers.get('sec-fetch-mode');
  if (mode) return mode === 'navigate';

  const accept = request.headers.get('accept');
  return !accept || accept.toLowerCase().includes('text/html');
}

function is_prefetch_request(headers: Headers) {
  return (
    has_header_token(headers.get('purpose'), 'prefetch') ||
    has_header_token(headers.get('sec-purpose'), 'prefetch')
  );
}

function has_header_token(value: string | null, token: string) {
  return (
    value
      ?.toLowerCase()
      .split(/[,\s]+/u)
      .includes(token) ?? false
  );
}

function is_sandbox_preview_request(request: Request) {
  const host = normalize_host(request.headers.get('host') ?? '');
  const configured_domain = process.env.SANDBOX_PREVIEW_BASE_DOMAIN ?? sandbox_preview_base_domain;
  return is_sandbox_preview_host(host, normalize_host(configured_domain));
}

function normalize_host(value: string) {
  return value.trim().toLowerCase().replace(/:\d+$/u, '').replace(/\.+$/u, '');
}
