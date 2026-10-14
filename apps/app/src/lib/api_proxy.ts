import { read_api_origin } from '@coworker/config/api_origin';
import { fetch_through_tunnel, set_upstream_tunnel_headers } from '@/lib/api/upstream_tunnel';
import { read_client_address } from '@/lib/client_address';
import { forwarded_cookie_names } from '@/lib/forwarded_tracking_cookies';
import { is_cross_origin_write } from '@/lib/same_origin_request';
import { read_workos_auth, type WorkosAuth, type WorkosUser } from '@/lib/workos_session';
import {
  resolve_workspace_proxy_secret,
  set_workspace_proxy_identity_headers,
  workspace_proxy_headers,
} from '@/lib/workspace_proxy_headers';

const upstream_request_headers = [
  'accept',
  'accept-language',
  'baggage',
  'content-type',
  'if-match',
  'last-event-id',
  'origin',
  'range',
  'sentry-trace',
  'user-agent',
];

export async function proxy_to_api(request: Request): Promise<Response> {
  if (is_cross_origin_write(request)) {
    return Response.json(
      { error: { code: 'forbidden', message: 'Cross-site request refused' } },
      { status: 403 },
    );
  }
  const auth = await read_workos_auth();
  if (!auth.user) {
    return Response.json(
      { error: { code: 'unauthorized', message: 'Sign in to use the API' } },
      { status: 401 },
    );
  }

  const request_url = new URL(request.url);
  const api_path = request_url.pathname.replace(/^\/api\//, '/');
  if (api_path.startsWith('/v1/auth/')) {
    return Response.json(
      { error: { code: 'forbidden', message: 'This route is not reachable from the browser' } },
      { status: 403 },
    );
  }
  const upstream_url = `${read_api_origin()}${api_path}${request_url.search}`;
  const headers = build_upstream_headers(request, upstream_url, { ...auth, user: auth.user });

  const has_body = request.method !== 'GET' && request.method !== 'HEAD';
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
    signal: request.signal,
    // duplex: 'half' is required by Node/undici whenever a streaming request body is sent.
    ...(has_body ? { body: request.body, duplex: 'half' } : {}),
  };

  const upstream = await fetch_through_tunnel(upstream_url, init, { can_retry: !has_body });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: build_response_headers(upstream),
  });
}

function build_upstream_headers(
  request: Request,
  upstream_url: string,
  auth: WorkosAuth & { user: WorkosUser },
) {
  const headers = forwardable_headers(request.headers);
  set_forwarded_cookie_header(headers, request.headers.get('cookie'));
  set_upstream_tunnel_headers(headers, upstream_url);
  set_client_ip_header(headers, request);
  headers.set(workspace_proxy_headers.secret, resolve_workspace_proxy_secret());
  set_workspace_proxy_identity_headers(
    headers,
    {
      id: auth.user.id,
      email: auth.user.email,
      firstName: auth.user.firstName,
      lastName: auth.user.lastName,
      profilePictureUrl: auth.user.profilePictureUrl,
    },
    auth.organizationId,
  );
  return headers;
}

export function set_client_ip_header(headers: Headers, request: Request) {
  const client_ip = read_client_address(request);
  if (client_ip) headers.set(workspace_proxy_headers.client_ip, client_ip);
}

function build_response_headers(upstream: Response) {
  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', 'no-cache, no-transform');
  headers.set('X-Accel-Buffering', 'no');
  headers.delete('content-encoding');
  headers.delete('content-length');
  return headers;
}

function forwardable_headers(incoming: Headers) {
  const headers = new Headers();
  for (const name of upstream_request_headers) {
    const value = incoming.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function set_forwarded_cookie_header(headers: Headers, browser_cookie_header: string | null) {
  const forwarded = forwarded_cookie_names
    .map((cookie_name) => read_cookie_pair(browser_cookie_header, cookie_name))
    .filter((pair) => pair !== null);
  if (forwarded.length > 0) headers.set('cookie', forwarded.join('; '));
}

function read_cookie_pair(cookie_header: string | null, cookie_name: string): string | null {
  const prefix = `${cookie_name}=`;
  const cookie = cookie_header
    ?.split(';')
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(prefix));
  return cookie ?? null;
}
