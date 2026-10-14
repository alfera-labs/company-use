import {
  find_reason_not_to_reach,
  resolve_host_addresses,
} from '@coworker/core/credentials/resolve_host_addresses';
import {
  is_blocked_address,
  type LookupAddresses,
} from '@coworker/core/credentials/safe_outbound_url';

type SendRequest = typeof fetch;

export function is_safe_icon_url(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !is_blocked_address(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * The address of a site's icon when the site serves one. Our own server asks for it and
 * follows where the site sends it, one hop at a time. Each address is checked before a request
 * goes to it, the first one and every redirect target, so a site cannot send the server on to
 * an address inside the network.
 */
export async function find_website_icon(input: {
  host: string;
  send_request?: SendRequest | undefined;
  lookup_addresses?: LookupAddresses | undefined;
}): Promise<string | null> {
  const icon_url = `https://${input.host}/favicon.ico`;
  try {
    const response = await follow_checked_hops(input, icon_url, most_icon_hops);
    if (!response?.ok) return null;
    const content_type = response.headers.get('content-type') ?? '';
    return content_type.startsWith('image/') ? icon_url : null;
  } catch {
    return null;
  }
}

const most_icon_hops = 3;

async function follow_checked_hops(
  input: Parameters<typeof find_website_icon>[0],
  url: string,
  hops_left: number,
): Promise<Response | null> {
  const lookup_addresses = input.lookup_addresses ?? resolve_host_addresses;
  if (await find_reason_not_to_reach(url, lookup_addresses)) return null;
  const response = await (input.send_request ?? fetch)(url, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
  });
  const moved_to = response.headers.get('location');
  if (response.status < 300 || response.status >= 400 || !moved_to) return response;
  if (hops_left === 0) return null;
  return follow_checked_hops(input, new URL(moved_to, url).toString(), hops_left - 1);
}
