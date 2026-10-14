import {
  probe_connected_account_identity,
  read_identity_display_name,
} from '@runtime-platform/composio/composio_account_identity';
import type { ComposioClient } from '@runtime-platform/composio/composio_client';
import { describe, expect, it, vi } from 'vitest';

const identity_answers: Array<[string, unknown, string]> = [
  ['gmail', { emailAddress: 'ada@example.com', messagesTotal: 395 }, 'ada@example.com'],
  ['slack auth.test', { ok: true, user: 'ada', team: 'Lovelace Ltd', user_id: 'U1' }, 'ada'],
  ['github', { login: 'ada-l', name: 'Ada Lovelace', email: null }, 'ada-l'],
  [
    'drive about',
    { user: { displayName: 'Ada', emailAddress: 'ada@example.com' } },
    'ada@example.com',
  ],
  [
    'linear graphql',
    { data: { viewer: { id: 'v1', name: 'Ada', email: 'ada@linear.app' } } },
    'ada@linear.app',
  ],
  [
    'outlook /me',
    { displayName: 'Ada', mail: 'ada@contoso.com', userPrincipalName: 'ada@contoso.com' },
    'ada@contoso.com',
  ],
  [
    'notion users/me',
    {
      object: 'user',
      name: 'Alfera bot',
      bot: { owner: { user: { person: { email: 'ada@example.com' } } } },
    },
    'ada@example.com',
  ],
  ['airtable whoami', { id: 'usr1', email: 'ada@example.com', scopes: [] }, 'ada@example.com'],
  ['hubspot details', { portalId: 123, uiDomain: 'app.hubspot.com' }, ''],
];

describe('read_identity_display_name', () => {
  it.each(identity_answers)('names the account from a %s answer', (_label, answer, expected) => {
    expect(read_identity_display_name(answer) ?? '').toBe(expected);
  });

  it('prefers an email deep in the answer over a name at the top', () => {
    expect(read_identity_display_name({ name: 'Ada', profile: { email: 'ada@example.com' } })).toBe(
      'ada@example.com',
    );
  });

  it('returns null for an answer with nothing identifying', () => {
    expect(read_identity_display_name({ ok: true, count: 3 })).toBeNull();
    expect(read_identity_display_name('plain text')).toBeNull();
  });
});

const account = {
  id: 'ca_1',
  toolkit: { slug: 'gmail' },
  status: 'ACTIVE' as const,
  word_id: 'gmail_topsy-sejoin',
};

function fake_client(input: { endpoint: string | null; proxy?: unknown }) {
  return {
    get_toolkit: vi.fn(async () => ({
      slug: 'gmail',
      name: 'Gmail',
      get_current_user_endpoint: input.endpoint,
      get_current_user_endpoint_method: 'GET',
      meta: {},
    })),
    proxy_execute: vi.fn(async () => input.proxy ?? { status: 200, data: {} }),
  } as unknown as ComposioClient & {
    get_toolkit: ReturnType<typeof vi.fn>;
    proxy_execute: ReturnType<typeof vi.fn>;
  };
}

describe('probe_connected_account_identity', () => {
  it('calls the toolkit identity endpoint through the proxy and keeps the whole answer', async () => {
    const client = fake_client({
      endpoint: 'https://www.googleapis.com/gmail/v1/users/me/profile',
      proxy: { status: 200, data: { emailAddress: 'ada@example.com', historyId: '4' } },
    });

    const identity = await probe_connected_account_identity(client, account);

    expect(identity).toEqual({
      endpoint: 'https://www.googleapis.com/gmail/v1/users/me/profile',
      data: { emailAddress: 'ada@example.com', historyId: '4' },
      display_name: 'ada@example.com',
    });
    expect(client.proxy_execute).toHaveBeenCalledWith({
      connected_account_id: 'ca_1',
      endpoint: 'https://www.googleapis.com/gmail/v1/users/me/profile',
      method: 'GET',
    });
  });

  it('skips the proxy when the toolkit publishes no identity endpoint', async () => {
    const client = fake_client({ endpoint: null });
    expect(await probe_connected_account_identity(client, account)).toBeNull();
    expect(client.proxy_execute).not.toHaveBeenCalled();
  });

  it('returns null when the probe fails, so the connection still activates', async () => {
    const client = fake_client({ endpoint: 'https://x', proxy: { status: 401, data: {} } });
    expect(await probe_connected_account_identity(client, account)).toBeNull();
    client.get_toolkit.mockRejectedValueOnce(new Error('offline'));
    expect(await probe_connected_account_identity(client, account)).toBeNull();
  });
});
