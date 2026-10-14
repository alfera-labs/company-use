import { describe, expect, it } from 'vitest';
import {
  decode_hosted_nonce,
  encode_hosted_state,
  hosted_auth_expiry_cookie,
  hosted_auth_set_cookie,
  read_hosted_auth_verifier,
} from '@/lib/workos_hosted_auth_state';

describe('decode_hosted_nonce', () => {
  it('reads back the nonce that encode_hosted_state minted', () => {
    const { state, nonce } = encode_hosted_state('/home');

    expect(decode_hosted_nonce(state)).toBe(nonce);
  });

  it('answers undefined for a state that is not base64 JSON', () => {
    expect(decode_hosted_nonce('not-base64-json')).toBeUndefined();
  });

  it('answers undefined for a state that carries no nonce', () => {
    const state = Buffer.from(JSON.stringify({ returnPathname: '/home' })).toString('base64url');

    expect(decode_hosted_nonce(state)).toBeUndefined();
  });

  it('answers undefined when the callback carries no state at all', () => {
    expect(decode_hosted_nonce(null)).toBeUndefined();
  });
});

describe('read_hosted_auth_verifier', () => {
  it('reads back the verifier that hosted_auth_set_cookie wrote', () => {
    const set_cookie = hosted_auth_set_cookie('nonce_a', 'verifier_test');

    const request = request_with_cookie_header(set_cookie.split(';')[0] ?? '');

    expect(read_hosted_auth_verifier(request, 'nonce_a')).toBe('verifier_test');
  });

  it('answers undefined for a nonce this browser holds no cookie for', () => {
    const set_cookie = hosted_auth_set_cookie('nonce_a', 'verifier_test');

    const request = request_with_cookie_header(set_cookie.split(';')[0] ?? '');

    expect(read_hosted_auth_verifier(request, 'nonce_b')).toBeUndefined();
  });

  it('answers undefined when the browser carries no cookie', () => {
    const request = new Request('https://app.example/auth/callback');

    expect(read_hosted_auth_verifier(request, 'nonce_a')).toBeUndefined();
  });
});

describe('hosted_auth_set_cookie', () => {
  it('stays far under the browser cookie limit for a very long return path', () => {
    const return_path = `/${'a'.repeat(2500)}`;
    const { nonce } = encode_hosted_state(return_path);

    const set_cookie = hosted_auth_set_cookie(nonce, 'verifier_test');

    expect(Buffer.byteLength(set_cookie)).toBeLessThan(600);
  });

  it('names one cookie per sign-in, so a second tab cannot overwrite the first', () => {
    const first = encode_hosted_state('/home');
    const second = encode_hosted_state('/settings');

    expect(cookie_name_of(hosted_auth_set_cookie(first.nonce, 'verifier_one'))).not.toBe(
      cookie_name_of(hosted_auth_set_cookie(second.nonce, 'verifier_two')),
    );
  });

  it('carries the attributes that keep the cookie in this browser only', () => {
    const set_cookie = hosted_auth_set_cookie('nonce_a', 'verifier_test');

    expect(set_cookie).toContain('HttpOnly');
    expect(set_cookie).toContain('SameSite=Lax');
    expect(set_cookie).toContain('Max-Age=600');
  });

  it('expires the one nonce it is given', () => {
    const expiry = hosted_auth_expiry_cookie('nonce_a');

    expect(cookie_name_of(expiry)).toBe('wos-hosted-auth-nonce_a');
    expect(expiry).toContain('Max-Age=0');
  });
});

function cookie_name_of(set_cookie: string) {
  return set_cookie.split('=')[0];
}

function request_with_cookie_header(cookie: string) {
  return new Request('https://app.example/auth/callback', { headers: { cookie } });
}
