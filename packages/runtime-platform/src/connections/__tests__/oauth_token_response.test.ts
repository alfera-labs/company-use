import { parse_oauth_token_response } from '@runtime-platform/connections/oauth_token_response';
import { describe, expect, it } from 'vitest';

function token_response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parse_oauth_token_response', () => {
  it('accepts the empty scope a GitHub App answers with', async () => {
    const parsed = await parse_oauth_token_response({
      response: token_response({
        access_token: 'ghu_token',
        expires_in: 28800,
        refresh_token: 'ghr_refresh',
        refresh_token_expires_in: 15897600,
        scope: '',
        token_type: 'bearer',
      }),
      provider_app_key: 'github',
    });

    expect(parsed.access_token).toBe('ghu_token');
    expect(parsed.scope).toBeUndefined();
  });

  it('accepts the scopes array HubSpot answers with', async () => {
    const parsed = await parse_oauth_token_response({
      response: token_response({
        access_token: 'hs_token',
        refresh_token: 'hs_refresh',
        expires_in: 1800,
        token_type: 'bearer',
        scopes: ['oauth', 'crm.objects.contacts.read'],
      }),
      provider_app_key: 'hubspot',
    });

    expect(parsed.access_token).toBe('hs_token');
    expect(parsed.scopes).toBe('oauth crm.objects.contacts.read');
  });

  it('keeps a real scope string', async () => {
    const parsed = await parse_oauth_token_response({
      response: token_response({ access_token: 'tok', scope: 'repo read:org' }),
      provider_app_key: 'github',
    });

    expect(parsed.scope).toBe('repo read:org');
  });

  it('still refuses a response with no access token', async () => {
    await expect(
      parse_oauth_token_response({
        response: token_response({ scope: '' }),
        provider_app_key: 'github',
      }),
    ).rejects.toThrow(/invalid github response/);
  });
});
