const retired_active_org_cookie_name = 'alfera_active_org';
const parent_domain_session_cookie_names = ['wos-session', retired_active_org_cookie_name];

const pkce_cookie_name_prefix = 'wos-auth-verifier';
const expired_cookie_date = new Date(0).toUTCString();

export function auth_hint_cookie_domain(): string | undefined {
  return process.env.AUTH_HINT_COOKIE_DOMAIN || undefined;
}

export function clear_workos_cookie_domain_env_var(): void {
  delete process.env.WORKOS_COOKIE_DOMAIN;
}

// Set-Cookie lines that expire the parent-domain copies of the session cookies this request still
// carries. A cookie's identity is its name, domain, and path, so these delete the `.alfera.ai`
// copies and leave the host-only ones the app now writes. Empty when no parent domain is
// configured (local dev), where a domain-less expiry would delete the host-only cookies themselves.
export function parent_domain_session_cookie_expiries(cookie_names: string[]): string[] {
  const domain = auth_hint_cookie_domain();
  if (!domain) return [];

  const pkce_names = cookie_names.filter((name) => name.startsWith(pkce_cookie_name_prefix));
  return [...parent_domain_session_cookie_names, ...pkce_names].map(
    (name) => `${name}=; Path=/; Domain=${domain}; Max-Age=0; Expires=${expired_cookie_date}`,
  );
}
