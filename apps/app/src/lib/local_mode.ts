import {
  is_local_mode_switched_on,
  read_local_user_name,
} from '@coworker/config/local_mode_switch';
import { built_in_account } from '@/lib/built_in_account';
import { local_user_id } from '@/lib/local_identity';
import { is_cross_origin_write } from '@/lib/same_origin_request';
import {
  authenticate_team_request,
  is_team_mode_on,
  refuse_request_in_team_mode,
} from '@/lib/team_mode';
import {
  authenticate_session_cookie,
  read_cookie_value,
  type SessionAuthentication,
  session_cookie_name,
  type WorkosUser,
} from '@/lib/workos_session';

export const local_organization_id = 'org_local';
const loopback_hostnames = new Set(['localhost', '127.0.0.1', '[::1]']);
const forwarded_request_headers = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'];

export const is_local_mode_on = is_local_mode_switched_on;

export function local_session(): SessionAuthentication {
  return { auth: { user: local_user(), organizationId: local_organization_id } };
}

/**
 * Local mode has no sign-in, so every request is the one local owner. Team mode asks the
 * install's own sessions. Otherwise the sign-in provider's session cookie decides.
 */
export function authenticate_request(request: Request): Promise<SessionAuthentication> {
  if (is_local_mode_on()) return Promise.resolve(local_session());
  if (is_team_mode_on()) return authenticate_team_request(request);
  return authenticate_session_cookie(
    read_cookie_value(request.headers.get('cookie'), session_cookie_name),
  );
}

/**
 * The refusal local mode or team mode has for this request, or null when it may go on. An
 * install that signs people in through a provider is in neither mode, and nothing is refused here.
 */
export async function refuse_request_in_its_sign_in_mode(
  request: Request,
): Promise<Response | null> {
  return refuse_request_in_local_mode(request) ?? refuse_request_in_team_mode(request);
}

/** The refusal for a request local mode must not serve, or null when the request may go on. */
export function refuse_request_in_local_mode(request: Request): Response | null {
  if (!is_local_mode_on()) return null;
  if (!is_request_from_this_machine(request)) {
    return plain_refusal(
      'This Alfera runs in local mode. It answers only on the machine it runs on, at http://localhost. For sign-in, run: ./alfera team link',
    );
  }
  if (is_cross_origin_write(request)) {
    return plain_refusal('Cross-site request refused.');
  }
  return null;
}

/**
 * Nothing proves who the caller is in local mode, so the only caller it serves is a browser on
 * this machine. A reverse proxy adds a forwarded header, and a request for another name carries
 * that name in Host: both mean the request did not start at this machine's own address bar.
 * A name under `.localhost` counts as this machine on purpose: a browser resolves every such
 * name to loopback, and the development setup gives each worktree one. Names compare without
 * regard to case. None of this is proof of who the caller is: a program on this machine, or in
 * a container that reaches its ports, can send any Host. A self-host therefore asks for a
 * session instead.
 */
export function is_request_from_this_machine(request: Request): boolean {
  if (forwarded_request_headers.some((name) => request.headers.has(name))) return false;
  const host = request.headers.get('host') ?? new URL(request.url).host;
  const hostname = host.toLowerCase().replace(/:\d+$/u, '');
  return loopback_hostnames.has(hostname) || hostname.endsWith('.localhost');
}

function local_user(): WorkosUser {
  return built_in_account({
    id: local_user_id,
    first_name: read_local_user_name(),
    last_name: null,
  });
}

function plain_refusal(message: string): Response {
  return new Response(message, {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
