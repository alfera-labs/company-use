const workos_callback_pathname = '/auth/callback';

export function build_workos_callback_url(request: Request) {
  const request_url = new URL(request.url);
  const url = new URL(
    `${read_forwarded_protocol(request, request_url)}://${read_forwarded_host(request, request_url)}`,
  );
  url.pathname = workos_callback_pathname;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function read_workos_return_path(request: Request) {
  return safe_return_path(new URL(request.url).searchParams.get('returnTo'));
}

// A returnTo is a same-site path or it is nothing: an absolute or protocol-relative value would send
// a freshly signed-in user off to somebody else's origin.
// A return path must stay on this origin. Checking for a leading `/` is not enough: the URL
// parser treats `/\evil.com` as an authority for http(s), so the value is resolved against a
// throwaway origin and refused whenever the origin moved.
const same_origin_probe = 'https://return-path.invalid';
// Long enough for any in-app deep link. The path rides inside the sign-in state and a cookie, and
// a cookie past 4 KB is dropped by the browser, which would make a long link fail sign-in.
const max_return_path_length = 2048;

export function safe_return_path(value: string | null | undefined) {
  const return_to = value?.trim();
  if (!return_to?.startsWith('/') || return_to.length > max_return_path_length) return '/';
  let resolved: URL;
  try {
    resolved = new URL(return_to, same_origin_probe);
  } catch {
    return '/';
  }
  if (resolved.origin !== same_origin_probe) return '/';
  // `/..//evil.example` keeps the origin but normalizes to the pathname `//evil.example`, which a
  // later resolve reads as a host again. A path is one leading slash, never two.
  if (resolved.pathname.startsWith('//')) return '/';
  if (resolved.pathname === '/auth' || resolved.pathname.startsWith('/auth/')) return '/';
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

const deep_links_that_survive_entry = ['/usage?'];

/** Only a deep link a person can arrive with from outside is kept across sign-in and onboarding. */
export function return_path_after_entry(requested_path: string) {
  return deep_links_that_survive_entry.some((prefix) => requested_path.startsWith(prefix))
    ? requested_path
    : '/';
}

export function workspace_entry_path(return_to: string) {
  return `/auth/organization/refresh?returnTo=${encodeURIComponent(return_to)}`;
}

function read_forwarded_protocol(request: Request, request_url: URL) {
  return request.headers.get('x-forwarded-proto') ?? request_url.protocol.replace(':', '');
}

function read_forwarded_host(request: Request, request_url: URL) {
  return request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request_url.host;
}
