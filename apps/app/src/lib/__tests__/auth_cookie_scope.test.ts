import { afterEach, describe, expect, it } from 'vitest';
import {
  auth_hint_cookie_domain,
  clear_workos_cookie_domain_env_var,
  parent_domain_session_cookie_expiries,
} from '@/lib/auth_cookie_scope';

describe('auth cookie scope', () => {
  afterEach(() => {
    delete process.env.AUTH_HINT_COOKIE_DOMAIN;
    delete process.env.WORKOS_COOKIE_DOMAIN;
  });

  it('reads the hint domain, and treats an empty value as unset', () => {
    process.env.AUTH_HINT_COOKIE_DOMAIN = '.alfera.ai';
    expect(auth_hint_cookie_domain()).toBe('.alfera.ai');

    process.env.AUTH_HINT_COOKIE_DOMAIN = '';
    expect(auth_hint_cookie_domain()).toBeUndefined();
  });

  it('expires the parent-domain copy of every session cookie', () => {
    process.env.AUTH_HINT_COOKIE_DOMAIN = '.alfera.ai';

    expect(parent_domain_session_cookie_expiries([])).toEqual([
      'wos-session=; Path=/; Domain=.alfera.ai; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'alfera_active_org=; Path=/; Domain=.alfera.ai; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ]);
  });

  it('expires the parent-domain PKCE verifiers the request actually carries', () => {
    process.env.AUTH_HINT_COOKIE_DOMAIN = '.alfera.ai';

    const expiries = parent_domain_session_cookie_expiries([
      'wos-auth-verifier-24f8f687',
      'wos-auth-verifier-9ab01cde',
      'alfera_attribution',
    ]);

    expect(expiries).toHaveLength(4);
    expect(expiries.filter((line) => line.startsWith('wos-auth-verifier-'))).toEqual([
      'wos-auth-verifier-24f8f687=; Path=/; Domain=.alfera.ai; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'wos-auth-verifier-9ab01cde=; Path=/; Domain=.alfera.ai; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ]);
    expect(expiries.some((line) => line.startsWith('alfera_attribution'))).toBe(false);
  });

  it('expires nothing when no parent domain is configured', () => {
    expect(parent_domain_session_cookie_expiries(['wos-auth-verifier-24f8f687'])).toEqual([]);
  });

  it('clears a WorkOS cookie domain left behind by the platform env', () => {
    process.env.WORKOS_COOKIE_DOMAIN = '.alfera.ai';

    clear_workos_cookie_domain_env_var();

    expect(process.env.WORKOS_COOKIE_DOMAIN).toBeUndefined();
  });
});
