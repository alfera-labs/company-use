import { read_api_origin } from '@coworker/config/api_origin';
import { set_upstream_tunnel_headers } from '@/lib/api/upstream_tunnel';

const api_origin = read_api_origin();

const hop_by_hop_headers = [
  'accept-encoding',
  'connection',
  'content-length',
  'cookie',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

export async function proxy_sandbox_preview(request: Request): Promise<Response> {
  const host = request.headers.get('host')?.trim();
  if (!host) {
    return Response.json(
      { error: { code: 'bad_request', message: 'Missing preview host' } },
      { status: 400 },
    );
  }

  const request_url = new URL(request.url);
  const upstream_url = new URL(
    `/internal/sandbox-preview-proxy${request_url.pathname === '/' ? '' : request_url.pathname}`,
    api_origin,
  );
  upstream_url.search = request_url.search;

  const headers = forwardable_headers(request.headers);
  set_upstream_tunnel_headers(headers, upstream_url.toString());
  headers.set('x-coworker-api-secret', resolve_proxy_secret());
  headers.set('x-coworker-preview-host', host);

  const has_body = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(upstream_url, {
    method: request.method,
    headers,
    redirect: 'manual',
    ...(has_body ? { body: request.body, duplex: 'half' } : {}),
  } as RequestInit & { duplex?: 'half' });

  const response_headers = new Headers(upstream.headers);
  response_headers.delete('content-encoding');
  response_headers.delete('content-length');
  response_headers.delete('set-cookie');
  response_headers.delete('set-cookie2');
  response_headers.set('Cache-Control', 'no-cache, no-transform');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: response_headers,
  });
}

function forwardable_headers(incoming: Headers) {
  const headers = new Headers(incoming);
  for (const name of hop_by_hop_headers) headers.delete(name);
  headers.delete('x-coworker-api-secret');
  headers.delete('x-coworker-preview-host');
  return headers;
}

function resolve_proxy_secret() {
  const explicit_secret = process.env.COWORKER_API_PROXY_SECRET;
  if (explicit_secret) return explicit_secret;
  if (process.env.NODE_ENV !== 'production') return 'local-development-internal-api-secret';
  throw new Error('COWORKER_API_PROXY_SECRET is required in production');
}
