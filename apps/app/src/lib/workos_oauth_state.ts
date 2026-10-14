import { z } from 'zod';
import { redirect_response } from '@/lib/http_response';
import { create_random_id } from '@/lib/random_id';
import { safe_return_path } from '@/lib/workos_auth_url';
import { is_secure_cookie } from '@/lib/workos_pending_authentication';
import { read_cookie_value } from '@/lib/workos_session';

// The proof that a provider sign-in came back to the same browser that started it. The value is
// echoed in two places WorkOS keeps apart — the `state` parameter it hands back, and a cookie only
// this site can set — so a link crafted elsewhere carries a state no cookie matches and is refused.
// It also carries where the person was heading, since a redirect cannot hold that on its own.
//
// The `__Host-` prefix makes the browser refuse this cookie if it ever arrives with a Domain
// attribute, which is what stops a sibling subdomain (a sandbox preview on *.sandboxes.alfera.ai)
// planting a Domain=alfera.ai copy to defeat the check. That prefix requires Secure, so local http
// development, which cannot set Secure cookies, uses the plain name.
const state_prefix = 'oauth.';
const state_lifetime_seconds = 10 * 60;
const state_cookie = is_secure_cookie ? '__Host-wos-oauth-state' : 'wos-oauth-state';

export function is_direct_oauth_state(state: string | null) {
  return state?.startsWith(state_prefix) ?? false;
}

export function encode_oauth_state(return_to: string) {
  const payload = JSON.stringify({ nonce: create_random_id(), return_to });
  return state_prefix + Buffer.from(payload).toString('base64url');
}

const oauth_state_schema = z.object({ return_to: z.unknown() });

export function decode_oauth_return_path(state: string) {
  try {
    const payload = oauth_state_schema.parse(
      JSON.parse(Buffer.from(state.slice(state_prefix.length), 'base64url').toString('utf8')),
    );
    return safe_return_path(typeof payload.return_to === 'string' ? payload.return_to : undefined);
  } catch {
    return '/';
  }
}

export function oauth_state_matches(request: Request, state: string) {
  return read_cookie_value(request.headers.get('cookie'), state_cookie) === state;
}

export function set_oauth_state_cookie(response: Response, state: string) {
  response.headers.append(
    'Set-Cookie',
    `${state_cookie}=${state}; ${state_cookie_attributes(state_lifetime_seconds)}`,
  );
}

export function state_cookie_attributes(max_age_seconds: number) {
  const attributes = ['Path=/', `Max-Age=${max_age_seconds}`, 'HttpOnly', 'SameSite=Lax'];
  if (is_secure_cookie) attributes.push('Secure');
  return attributes.join('; ');
}

export function redirect_and_clear_oauth_state(request: Request, path: string) {
  const response = redirect_response(new URL(path, request.url));
  response.headers.append('Set-Cookie', `${state_cookie}=; ${state_cookie_attributes(0)}`);
  return response;
}
