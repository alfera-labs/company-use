// A state-changing POST that a browser makes from our own page carries Sec-Fetch-Site: same-origin
// (a forbidden header the page's JS cannot forge) and an Origin that matches our host. A cross-site
// forgery — including an enctype="text/plain" form that smuggles JSON past the CORS preflight —
// carries neither. Session-minting endpoints reject anything that is not provably same-origin, so a
// malicious page cannot force a login into an attacker-controlled account.
const methods_without_side_effects = new Set(['GET', 'HEAD', 'OPTIONS']);

export function is_cross_origin_write(request: Request) {
  return !methods_without_side_effects.has(request.method) && !is_same_origin_request(request);
}

export function is_same_origin_request(request: Request) {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';

  // Older browsers omit Sec-Fetch-Site; fall back to comparing the Origin against our own host.
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * The proof team mode asks of a write: it came from a page of this install. A team install is
 * often on plain http, where a browser sends no Sec-Fetch-Site, and a form POST may carry no
 * Origin either. Then a Referer on this host is the proof. An Origin that is present and wrong
 * is never rescued by a Referer, and a write with none of the three is refused. Host names
 * compare without regard to case.
 */
export function is_write_from_own_page(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';

  const own_host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host'))
    ?.trim()
    .toLowerCase();
  if (!own_host) return false;
  const origin = request.headers.get('origin');
  if (origin !== null) return host_of(origin) === own_host;
  const referer = request.headers.get('referer');
  return referer !== null && host_of(referer) === own_host;
}

function host_of(address: string): string | null {
  try {
    return new URL(address).host.toLowerCase();
  } catch {
    return null;
  }
}
