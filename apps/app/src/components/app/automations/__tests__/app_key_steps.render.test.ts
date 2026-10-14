// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddTriggerMenu } from '@/components/app/automations/add_trigger_menu';
import { query_keys } from '@/lib/api/query_keys';

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

async function open_the_menu_on_an_install(install: { app_provider_configured: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(query_keys.onboarding(), { install });
  const menu = createElement(AddTriggerMenu, { catalog: undefined, onAdd: vi.fn() });
  act(() => root.render(createElement(QueryClientProvider, { client }, menu)));
  await act(async () =>
    container.querySelector<HTMLElement>('[aria-label="Add trigger"]')?.click(),
  );
}

function menu_items() {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

const row_for_apps = 'Gmail, HubSpot, Slack and other apps';

describe('the trigger menu of an install with no app-provider key', () => {
  it('offers the apps as one row, and the row opens the five steps with their commands', async () => {
    await open_the_menu_on_an_install({ app_provider_configured: false });

    const row = menu_items().find((item) => item.textContent?.includes(row_for_apps));
    expect(row?.textContent).toContain('Set up');
    await act(async () => row?.click());

    const steps = [...document.querySelectorAll('[role="dialog"] ol > li')];
    expect(steps.map((step) => step.querySelector('div > div')?.textContent)).toEqual([
      'Make a Composio account and copy its API key',
      'Give the key to this install',
      'Give this install a public address',
      'Point Composio at this install',
      'Reload this page',
    ]);
    const commands = [...document.querySelectorAll('[role="dialog"] code')];
    expect(commands.map((command) => command.textContent)).toEqual([
      './alfera add apps',
      './alfera add https',
      './alfera add triggers',
    ]);
  });

  it('shows no such row on an install that has the key', async () => {
    await open_the_menu_on_an_install({ app_provider_configured: true });

    expect(menu_items().some((item) => item.textContent?.includes(row_for_apps))).toBe(false);
    expect(menu_items().map((item) => item.textContent?.trim())).toContain('Scheduled');
  });
});
