// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeyForm } from '@/components/app/api_key_form';

function refuse_the_key() {
  return Promise.resolve(
    Response.json(
      { error: { code: 'invalid_api_key', message: 'The provider refused this key.' } },
      { status: 422 },
    ),
  );
}

let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(refuse_the_key));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function type_into(input: HTMLInputElement, value: string) {
  const set_value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  set_value?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('connecting an API key that the provider refuses', () => {
  it('says what the server said, and offers no plan to buy', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(ApiKeyForm, { on_connected: () => {} }),
        ),
      ),
    );
    const field = document.querySelector<HTMLInputElement>('input');
    if (!field) throw new Error('The key field did not render');
    await act(async () => type_into(field, 'sk-test-not-a-real-key'));
    await act(async () => field.form?.requestSubmit());
    await act(() =>
      vi.waitFor(() =>
        expect(document.body.textContent).toContain('The provider refused this key.'),
      ),
    );

    expect([...document.querySelectorAll('a')].map((anchor) => anchor.textContent)).toEqual([]);
    expect(document.body.textContent).not.toContain('plan');
  });
});
