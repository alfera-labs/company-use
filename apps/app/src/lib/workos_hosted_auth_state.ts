import { z } from 'zod';
import { create_random_id } from '@/lib/random_id';
import { safe_return_path, workspace_entry_path } from '@/lib/workos_auth_url';
import { state_cookie_attributes } from '@/lib/workos_oauth_state';
import { is_secure_cookie } from '@/lib/workos_pending_authentication';
import { read_cookie_value } from '@/lib/workos_session';

// What the hosted AuthKit sign-in leaves behind in the browser that started it: the PKCE verifier
// that the code exchange must present, and nothing else. The nonce that names the cookie also
// travels in the `state` parameter WorkOS echoes back, so a callback opened in any other browser
// names a cookie that browser does not have and the code is never spent.
//
// One cookie per nonce, holding only the verifier. Two reasons. A single shared name let a second
// sign-in tab overwrite the first tab's verifier, and let a refused callback in one tab delete the
// other tab's. And the value stays short: the state, which carries the return path, used to be
// packed into the cookie too, so a long return path pushed the Set-Cookie line past the 4096-byte
// browser limit and the browser dropped the whole cookie.
//
// The `__Host-` prefix makes the browser refuse this cookie if it ever arrives with a Domain
// attribute, which is what stops a sibling subdomain (a sandbox preview on *.sandboxes.alfera.ai)
// planting a Domain=alfera.ai copy to defeat the check. That prefix requires Secure, so local http
// development, which cannot set Secure cookies, uses the plain name.
const hosted_cookie_prefix = is_secure_cookie ? '__Host-wos-hosted-auth-' : 'wos-hosted-auth-';
const hosted_lifetime_seconds = 10 * 60;

export function encode_hosted_state(return_pathname: string) {
  const nonce = create_random_id();
  const payload = { nonce, returnPathname: return_pathname };
  return { state: Buffer.from(JSON.stringify(payload)).toString('base64url'), nonce };
}

export function decode_hosted_nonce(state: string | null): string | undefined {
  const payload = decode_hosted_state(state);
  return typeof payload?.nonce === 'string' ? payload.nonce : undefined;
}

export function decode_hosted_return_path(state: string | null): string {
  const payload = decode_hosted_state(state);
  if (typeof payload?.returnPathname !== 'string') return workspace_entry_path('/');
  if (payload.returnPathname.startsWith('/auth/organization/refresh')) {
    return payload.returnPathname;
  }
  return workspace_entry_path(safe_return_path(payload.returnPathname));
}

const hosted_state_schema = z.object({ nonce: z.unknown(), returnPathname: z.unknown() });

function decode_hosted_state(state: string | null) {
  if (!state) return undefined;
  try {
    return hosted_state_schema.parse(JSON.parse(Buffer.from(state, 'base64url').toString('utf8')));
  } catch {
    return undefined;
  }
}

export function hosted_auth_set_cookie(nonce: string, code_verifier: string) {
  return `${hosted_cookie_prefix}${nonce}=${code_verifier}; ${state_cookie_attributes(hosted_lifetime_seconds)}`;
}

export function hosted_auth_expiry_cookie(nonce: string) {
  return `${hosted_cookie_prefix}${nonce}=; ${state_cookie_attributes(0)}`;
}

export function read_hosted_auth_verifier(request: Request, nonce: string): string | undefined {
  return read_cookie_value(request.headers.get('cookie'), `${hosted_cookie_prefix}${nonce}`);
}
