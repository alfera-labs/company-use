import { describe, expect, it } from 'vitest';
import { is_protected_path } from '@/lib/protected_path';

describe('is_protected_path', () => {
  it('protects dashboard + admin pages', () => {
    expect(is_protected_path('/')).toBe(true);
    expect(is_protected_path('/chats/abc')).toBe(true);
    expect(is_protected_path('/admin')).toBe(true);
  });

  it('lets the API proxy and auth/connect callbacks through', () => {
    expect(is_protected_path('/api/v1/sessions')).toBe(false);
    expect(is_protected_path('/_widgets/UserProfile/me')).toBe(false);
    expect(is_protected_path('/auth/callback')).toBe(false);
    expect(is_protected_path('/auth/sign-in')).toBe(false);
    expect(is_protected_path('/auth/sign-in/google')).toBe(false);
    expect(is_protected_path('/auth/sign-in/slack')).toBe(false);
    expect(is_protected_path('/auth/email/send-code')).toBe(false);
    expect(is_protected_path('/auth/email/verify-code')).toBe(false);
    expect(is_protected_path('/callback')).toBe(false);
    expect(is_protected_path('/sign-in')).toBe(false);
    expect(is_protected_path('/sign-up')).toBe(false);
    expect(is_protected_path('/connect/callback')).toBe(false);
  });

  it('opens the referral link and the error-report tunnel to signed-out visitors', () => {
    expect(is_protected_path('/join/ws_123')).toBe(false);
    expect(is_protected_path('/monitoring')).toBe(false);
    expect(is_protected_path('/monitoring/envelope')).toBe(false);
    expect(is_protected_path('/joined-workspaces')).toBe(true);
    expect(is_protected_path('/monitoring-admin')).toBe(true);
  });

  it('opens the deploy page to signed-out visitors and nothing below it', () => {
    expect(is_protected_path('/deploy')).toBe(false);
    expect(is_protected_path('/deploy/anything')).toBe(true);
    expect(is_protected_path('/deployments')).toBe(true);
  });

  it('opens the design system reference in development and closes it in production', () => {
    expect(is_protected_path('/design-system', 'development')).toBe(false);
    expect(is_protected_path('/design-system', 'test')).toBe(false);
    expect(is_protected_path('/design-system', 'production')).toBe(true);
    expect(is_protected_path('/design-system/compare', 'development')).toBe(false);
    expect(is_protected_path('/design-system/compare', 'production')).toBe(true);
    expect(is_protected_path('/design-systems-admin', 'development')).toBe(true);
  });
});
