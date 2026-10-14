import type { ApiEnv } from '@api/lib/context';
import { proxy_auth_headers, require_proxy_identity_with_body } from '@api/lib/proxy_identity';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

const test_proxy_secret = 'local-development-internal-api-secret';

function echo_identity() {
  return new Hono<ApiEnv>().post('/echo', async (c) =>
    c.json(require_proxy_identity_with_body(c, await c.req.json())),
  );
}

describe('an identity read from a request body', () => {
  it('builds workspace and user data itself, and keeps only an https picture from the body', async () => {
    const response = await echo_identity().request('/echo', {
      method: 'POST',
      headers: {
        [proxy_auth_headers.secret]: test_proxy_secret,
        [proxy_auth_headers.provider_key]: 'workos',
        [proxy_auth_headers.provider_user_id]: 'user_a',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider_key: 'workos',
        provider_user_id: 'user_a',
        user_data: { profile_picture_url: 'https://pics.example/a.png', role: 'admin' },
        workspace_data: { inbound_email: { retired_usernames: ['someone-else'] } },
      }),
    });

    const identity = await response.json();
    expect(identity.workspace_data).toEqual({ provider: 'workos' });
    expect(identity.user_data).toEqual({
      provider: 'workos',
      provider_user_id: 'user_a',
      profile_picture_url: 'https://pics.example/a.png',
    });
  });
});
