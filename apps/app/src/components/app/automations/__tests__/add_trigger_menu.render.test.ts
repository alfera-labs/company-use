// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddTriggerMenu } from '@/components/app/automations/add_trigger_menu';
import type { TriggerTypeCatalog } from '@/components/app/automations/automations_api';

const catalog = {
  count: 1,
  apps: [
    {
      app_id: 'composio_gmail',
      app_display_name: 'Gmail',
      icon_url: null,
      connected: true,
      connection_id: 'conn_1',
      trigger_types: [
        {
          node_key: 'composio_gmail-new_gmail_message-1',
          display_name: 'New Gmail message received',
          display_name_without_app: 'New message received',
          description: null,
        },
      ],
    },
  ],
} as unknown as TriggerTypeCatalog;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('the Add trigger menu', () => {
  it('opens with Scheduled, When you ask and the webhook first, then the apps', async () => {
    act(() => root.render(createElement(AddTriggerMenu, { catalog, onAdd: vi.fn() })));
    await act(async () =>
      container.querySelector<HTMLElement>('[aria-label="Add trigger"]')?.click(),
    );

    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) =>
      item.textContent?.trim(),
    );
    expect(items.slice(0, 3)).toEqual([
      'Scheduled',
      'When you ask',
      'When anything on the web calls it',
    ]);
    expect(items[3]).toContain('Gmail');
  });

  it("groups search results under the app, each trigger in the API's words without the app", async () => {
    act(() => root.render(createElement(AddTriggerMenu, { catalog, onAdd: vi.fn() })));
    await act(async () =>
      container.querySelector<HTMLElement>('[aria-label="Add trigger"]')?.click(),
    );
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search all triggers"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(search, 'message');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const items = [...document.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent,
    );
    expect(items).toEqual(['New message received']);
    expect(document.body.textContent).toContain('Gmail');
  });
});
