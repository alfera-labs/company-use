import { describe, expect, it } from 'vitest';
import {
  build_workos_callback_url,
  read_workos_return_path,
  return_path_after_entry,
  safe_return_path,
} from '@/lib/workos_auth_url';

describe('WorkOS auth URLs', () => {
  it('builds the callback URL on the current request origin', () => {
    const request = new Request('http://app.localhost:3000/sessions?x=1');

    expect(build_workos_callback_url(request)).toBe('http://app.localhost:3000/auth/callback');
  });

  it('uses forwarded host and protocol from the public edge request', () => {
    const request = new Request('http://internal:3000/sign-in', {
      headers: {
        host: 'internal:3000',
        'x-forwarded-host': 'app.alfera.ai',
        'x-forwarded-proto': 'https',
      },
    });

    expect(build_workos_callback_url(request)).toBe('https://app.alfera.ai/auth/callback');
  });

  it('reads safe same-origin sign-in return paths', () => {
    const request = new Request(
      'http://app.localhost:3000/auth/sign-in?returnTo=%2Fapp%2Fsessions%2Fx%3Ftab%3Druns',
    );

    expect(read_workos_return_path(request)).toBe('/app/sessions/x?tab=runs');
  });

  it('rejects external sign-in return paths', () => {
    const external = new Request(
      'http://app.localhost:3000/auth/sign-in?returnTo=https%3A%2F%2Fevil.example',
    );
    const protocol_relative = new Request(
      'http://app.localhost:3000/auth/sign-in?returnTo=%2F%2Fevil.example',
    );

    expect(read_workos_return_path(external)).toBe('/');
    expect(read_workos_return_path(protocol_relative)).toBe('/');
  });
});

describe('safe_return_path', () => {
  it.each([
    ['/\\evil.example', '/'],
    ['/\\\\evil.example/x', '/'],
    ['//evil.example', '/'],
    ['/..//evil.example', '/'],
    ['/.//evil.example', '/'],
    ['/a/..//evil.example/p', '/'],
    ['https://evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/auth/organization/refresh?returnTo=%2F', '/'],
    ['/auth/sign-in', '/'],
    [`/${'a'.repeat(2100)}`, '/'],
    ['', '/'],
    [null, '/'],
  ])('refuses %s', (value, expected) => {
    expect(safe_return_path(value)).toBe(expected);
  });

  it('keeps a same-origin path with its query and hash', () => {
    expect(safe_return_path('/usage?plan=business#top')).toBe('/usage?plan=business#top');
    expect(safe_return_path('/%09/evil.example')).toBe('/%09/evil.example');
  });
});

describe('return_path_after_entry', () => {
  it('keeps the usage link and drops everything else', () => {
    expect(return_path_after_entry('/usage?plan=business')).toBe('/usage?plan=business');
    expect(return_path_after_entry('/usage')).toBe('/');
    expect(return_path_after_entry('/settings/models')).toBe('/');
  });
});
