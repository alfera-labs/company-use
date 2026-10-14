import { describe, expect, it } from 'vitest';

import { build_sign_in_url_for_current_page } from '@/lib/api/client';

describe('build_sign_in_url_for_current_page', () => {
  it('preserves the current path, query, and hash in returnTo', () => {
    const sign_in_url = build_sign_in_url_for_current_page({
      hash: '#members',
      origin: 'https://app.alfera.ai',
      pathname: '/settings',
      search: '?tab=team',
    });

    expect(sign_in_url.toString()).toBe(
      'https://app.alfera.ai/auth/sign-in?returnTo=%2Fsettings%3Ftab%3Dteam%23members',
    );
  });
});
