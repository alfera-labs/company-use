import { sleep } from '@coworker/shared';

const ngrok_skip_warning_header = {
  name: 'ngrok-skip-browser-warning',
  value: 'true',
} as const;

const local_hostnames = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

// ngrok domains have varied over time (.ngrok.io, .ngrok-free.app, .ngrok-free.dev, .ngrok.app,
// custom subdomains); any host containing "ngrok" is a tunnel, and nothing in cloud ever is.
function is_ngrok_host(hostname: string): boolean {
  return hostname.includes('ngrok');
}

function is_local_tunnel_target(url: string | URL): boolean {
  if (process.env.VERCEL) return false;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return local_hostnames.has(hostname) || is_ngrok_host(hostname);
}

// ngrok serves an HTML "you are about to visit" interstitial in front of any request whose Accept
// header includes text/html; the browser's forwarded Accept does, so server->API fetches get that
// HTML back instead of JSON. `ngrok-skip-browser-warning` makes ngrok pass through. We only add it
// for a local ngrok target — never in cloud. The target URL is required so the guard can run.
export function set_upstream_tunnel_headers(headers: Headers, target: string | URL) {
  if (is_local_tunnel_target(target)) {
    headers.set(ngrok_skip_warning_header.name, ngrok_skip_warning_header.value);
  }
  return headers;
}

// ngrok's free-tier edge intermittently drops connections: undici keeps a keep-alive pool, so a
// socket the edge silently closed fails the next request with UND_ERR_SOCKET ("other side closed",
// bytesRead: 0), and a slow-network handshake can trip undici's 10s connect timeout as
// UND_ERR_CONNECT_TIMEOUT. Both are transient — a fresh connection on retry succeeds.
const transient_connection_codes = new Set([
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
]);

function is_transient_connection_error(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  const code = cause?.code ?? (error as { code?: string })?.code;
  return typeof code === 'string' && transient_connection_codes.has(code);
}

const max_attempts = 3;
const retry_backoff_ms = 150;

export async function fetch_through_tunnel(
  input: string | URL,
  init: RequestInit & { duplex?: 'half' },
  options: { can_retry?: boolean } = {},
): Promise<Response> {
  if (!is_local_tunnel_target(input)) return fetch(input, init);

  const can_retry = options.can_retry ?? true;
  let last_error: unknown;
  for (let attempt = 1; attempt <= max_attempts; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      last_error = error;
      const should_retry =
        can_retry && attempt < max_attempts && is_transient_connection_error(error);
      if (!should_retry) throw error;
      await sleep(retry_backoff_ms * attempt);
    }
  }
  throw last_error;
}
