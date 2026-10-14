import { describe, expect, it, vi } from 'vitest';

let cookie_header = '';
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () =>
    new Request('https://app.example/sign-in', {
      headers: cookie_header ? { cookie: cookie_header } : {},
    }),
}));

import {
  has_pending_authentication,
  pending_authentication_expiry_cookie,
  pending_authentication_set_cookie,
  read_pending_authentication,
  read_pending_authentication_token,
} from '@/lib/workos_pending_authentication';

describe('read_pending_authentication', () => {
  it('answers a multi-workspace stop in the app, carrying the user to resolve with', () => {
    expect(
      read_pending_authentication(
        error_with({
          code: 'organization_selection_required',
          pendingAuthenticationToken: 'p1',
          rawData: { user: { id: 'user_1', email: 'robin@example.com' } },
        }),
      ),
    ).toEqual({
      plan: 'in_app',
      state: 'organization_selection_required',
      token: 'p1',
      user: { id: 'user_1', email: 'robin@example.com', firstName: null, lastName: null },
    });
  });

  it('hands over an org-selection stop that names no user', () => {
    expect(
      read_pending_authentication(
        error_with({ code: 'organization_selection_required', pendingAuthenticationToken: 'p1' }),
      ),
    ).toEqual({ plan: 'hosted', state: 'organization_selection_required' });
  });

  it('answers an email-ownership stop in the app, carrying the address', () => {
    expect(
      read_pending_authentication(
        error_with({
          code: 'email_verification_required',
          pendingAuthenticationToken: 'p2',
          rawData: { email: 'robin@example.com' },
        }),
      ),
    ).toEqual({
      plan: 'in_app',
      state: 'email_verification_required',
      token: 'p2',
      email: 'robin@example.com',
    });
  });

  it.each([
    'mfa_enrollment',
    'mfa_challenge',
    'sso_required',
    'radar_email_challenge_required',
    'radar_sms_challenge_required',
  ])('hands %s to the hosted flow', (code) => {
    expect(
      read_pending_authentication(error_with({ code, pendingAuthenticationToken: 'p3' })),
    ).toEqual({ plan: 'hosted', state: code });
  });

  it('hands over an in-app stop that arrived without a resume token', () => {
    expect(
      read_pending_authentication(error_with({ code: 'organization_selection_required' })),
    ).toEqual({ plan: 'hosted', state: 'organization_selection_required' });
  });

  it('ignores an ordinary failure', () => {
    expect(read_pending_authentication(new Error('network died'))).toBeUndefined();
    expect(read_pending_authentication(error_with({ code: 'invalid_grant' }))).toBeUndefined();
  });
});

describe('the resume-token cookie', () => {
  it('is httpOnly and short-lived, and reads back from the request', () => {
    const set_cookie = pending_authentication_set_cookie('p1');
    expect(set_cookie).toContain('HttpOnly');
    expect(set_cookie).toContain('Max-Age=900');

    const name = set_cookie.split('=')[0] ?? '';
    const request = new Request('https://app.example/auth/email/verify-ownership', {
      headers: { cookie: `${name}=p1` },
    });
    expect(read_pending_authentication_token(request)).toBe('p1');
  });

  it('expires with Max-Age=0 once spent', () => {
    expect(pending_authentication_expiry_cookie()).toContain('Max-Age=0');
  });
});

function error_with(fields: Record<string, unknown>) {
  return Object.assign(new Error('workos stopped the sign-in'), fields);
}

describe('has_pending_authentication', () => {
  it('is false when no sign-in is paused', async () => {
    cookie_header = '';
    expect(await has_pending_authentication()).toBe(false);
  });

  it('is true once the callback has parked a resume token', async () => {
    const set_cookie = pending_authentication_set_cookie('p1');
    cookie_header = set_cookie.slice(0, set_cookie.indexOf(';'));
    expect(await has_pending_authentication()).toBe(true);
  });
});
