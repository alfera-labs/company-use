const workos_api_base = process.env.WORKOS_BASE_API_URL ?? 'https://api.workos.com';

const forwarded_widget_headers = [
  'accept',
  'authorization',
  'content-type',
  'workos-widgets-type',
  'x-elevated-access-token',
] as const;

const response_hop_by_hop_headers = [
  'connection',
  'content-encoding',
  'content-length',
  'set-cookie',
  'transfer-encoding',
] as const;

export function build_workos_widget_upstream_url(request_url: string, path: string[]) {
  const request = new URL(request_url);
  const encoded_path = path.map(encode_widget_path_part).join('/');
  const upstream = new URL(`/${encoded_path}`, workos_api_base);
  upstream.search = request.search;
  return upstream.toString();
}

// encodeURIComponent leaves dots and would let an encoded `..` part collapse the
// upstream path. Reject traversal and separator characters so a crafted request
// can only reach the path the widget actually addressed.
function encode_widget_path_part(part: string) {
  if (part === '.' || part === '..' || /[/\\]/.test(part)) {
    throw new Error(`Unsafe WorkOS widget path segment: ${part}`);
  }
  return encodeURIComponent(part);
}

export function forward_workos_widget_headers(incoming: Headers) {
  const headers = new Headers();
  for (const name of forwarded_widget_headers) {
    const value = incoming.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export function build_workos_widget_response_headers(upstream: Headers) {
  const headers = new Headers(upstream);
  for (const name of response_hop_by_hop_headers) headers.delete(name);
  headers.set('Cache-Control', 'no-cache, no-transform');
  return headers;
}
