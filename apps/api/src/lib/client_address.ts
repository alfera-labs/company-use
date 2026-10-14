import type { ApiEnv } from '@api/lib/context';
import { carries_the_proxy_secret, proxy_auth_headers } from '@api/lib/proxy_identity';
import type { Context } from 'hono';

/**
 * The address of the person behind a request, the key of every rate limit. The app server
 * names it in its own header, and that header counts only with the proxy secret. Any other
 * caller is named by the last X-Forwarded-For entry: the front end in front of the API
 * appends the address it saw, and a caller can only write the entries before it.
 */
export function read_client_address(c: Context<ApiEnv>): string {
  const named_by_the_app = carries_the_proxy_secret(c)
    ? c.req.header(proxy_auth_headers.client_ip)?.trim()
    : undefined;
  const seen_by_the_front_end = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
  return named_by_the_app || seen_by_the_front_end || 'address not known';
}
