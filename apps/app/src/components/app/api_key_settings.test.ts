// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeySettings } from '@/components/app/api_key_settings';
import { ApiError } from '@/lib/api/client';
import { query_keys } from '@/lib/api/query_keys';
import type { ApiKey, MintedApiKey } from '@/lib/api/types';

const create_api_key = vi.fn();

function answer_api_request(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init);
  if (request.method !== 'POST') return new Promise<Response>(() => undefined);
  return request.json().then(async (body) => Response.json({ data: await create_api_key(body) }));
}

const fake_secret = 'ak_test_not_a_real_secret_0123456789';

const existing_key = {
  api_key_id: 'key_1',
  workspace_id: 'ws_1',
  key_name: 'Support bot',
  key_prefix: 'ak_test_abcd',
  key_status: 'active',
  key_audience: 'internal',
  scopes: ['answers.write'],
  last_used_time: null,
  expires_time: null,
  revoked_time: null,
  created_time: '2026-09-26T09:00:00.000Z',
  created_by: 'usr_1',
} satisfies ApiKey;

let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(answer_api_request));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  create_api_key.mockReset();
  vi.unstubAllGlobals();
});

function mount_card(keys: ApiKey[] | ApiError) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false } },
  });
  if (keys instanceof ApiError) {
    const query = client.getQueryCache().build(client, { queryKey: query_keys.api_keys() });
    query.setState({ status: 'error', error: keys, fetchStatus: 'idle' });
  } else {
    client.setQueryData(query_keys.api_keys(), keys);
  }
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(createElement(QueryClientProvider, { client }, createElement(ApiKeySettings))),
  );
}

function button_named(name: string) {
  return [...document.querySelectorAll('button')].find((button) => button.textContent === name);
}

function type_into(input: HTMLInputElement, value: string) {
  const set_value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  set_value?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('the API keys card', () => {
  it('offers an admin with no keys a Create key button and the docs', () => {
    mount_card([]);

    expect(button_named('Create key')).toBeDefined();
    expect(document.body.textContent).toContain('Read the docs');
    expect(document.body.textContent).not.toContain('Request access');
  });

  it('offers an admin with keys the list and a Create key button', () => {
    mount_card([existing_key]);

    expect(document.body.textContent).toContain('Support bot');
    expect(button_named('Create key')).toBeDefined();
  });

  it('tells a non-admin to ask an admin and offers no way to create a key', () => {
    mount_card(new ApiError('API keys require workspace admin access', 403));

    expect(document.body.textContent).toContain('Ask a workspace admin to create a key');
    expect(button_named('Create key')).toBeUndefined();
  });

  it('creates a full-access key by default and shows the secret only until the dialog closes', async () => {
    const minted: MintedApiKey = {
      api_key: { ...existing_key, key_name: 'My bot' },
      secret: fake_secret,
    };
    create_api_key.mockResolvedValue(minted);
    mount_card([]);

    await act(async () => button_named('Create key')?.click());
    const name = document.querySelector<HTMLInputElement>('#api-key-name');
    if (!name) throw new Error('The name field did not open');
    await act(async () => type_into(name, 'My bot'));
    await act(async () => name.form?.requestSubmit());

    const request = create_api_key.mock.calls[0]?.[0] as { key_audience: string; scopes: string[] };
    expect(request.key_audience).toBe('internal');
    expect(request.scopes).toContain('sessions.write');
    expect(document.body.textContent).toContain(fake_secret);
    expect(document.body.textContent).toContain("You won't see it again");

    await act(async () => button_named('Done')?.click());
    expect(document.body.textContent).not.toContain(fake_secret);

    await act(async () => button_named('Create key')?.click());
    expect(document.body.textContent).not.toContain(fake_secret);
    expect(document.querySelector('#api-key-name')).not.toBeNull();
  });
});
