import { describe, expect, it } from 'vitest';
import {
  build_settings_widget_tokens,
  users_management_widget_permission,
} from '@/lib/settings_widget_tokens';

describe('build_settings_widget_tokens', () => {
  it('uses the AuthKit access token for profile management without an organization', () => {
    expect(
      build_settings_widget_tokens({
        accessToken: 'access_token',
        user: { id: 'user_123' },
      }),
    ).toEqual({
      profile_token: 'access_token',
      team_token_can_manage_users: false,
    });
  });

  it('enables team management only when the organization token has the users permission', () => {
    expect(
      build_settings_widget_tokens({
        accessToken: 'access_token',
        organizationId: 'org_123',
        permissions: [users_management_widget_permission],
        user: { id: 'user_123' },
      }),
    ).toEqual({
      profile_token: 'access_token',
      team_token_can_manage_users: true,
    });
  });

  it('does not expose a token when no user is signed in', () => {
    expect(
      build_settings_widget_tokens({
        accessToken: 'access_token',
        organizationId: 'org_123',
        permissions: [users_management_widget_permission],
        user: null,
      }),
    ).toEqual({
      profile_token: null,
      team_token_can_manage_users: false,
    });
  });
});
