// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const automation = (
  automation_id: string,
  automation_name: string,
  trigger_types: string[],
  metadata: Record<string, unknown> = {},
) => ({
  automation_id,
  automation_name,
  automation_status: 'enabled',
  instruction: `Handle ${automation_name}.\nSecond line stays off the list.`,
  metadata,
  last_run_time: null,
  triggers: trigger_types.map((trigger_type, index) => ({
    trigger_id: `${automation_id}_${index}`,
    trigger_type,
    trigger_config: {},
    schedule_expression: '0 9 * * 1',
    app: null,
  })),
});

vi.mock('@/components/app/automations/automations_api', () => ({
  list_automations: async () => [
    automation('aut_goal', 'Goal: Build a billion-dollar company', ['schedule'], {
      node_key: 'goals-create_goal-1',
    }),
    automation('aut_mail', 'Answer new mail', ['composio', 'manual']),
    automation('aut_clock', 'Monday digest', ['schedule']),
  ],
  list_trigger_types: async () => ({ groups: [] }),
  set_automation_status: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  list_triggers: async () => [
    {
      trigger_id: 'trg_report',
      trigger_name: 'Monday Leadership Report',
      trigger_type: 'schedule',
      trigger_status: 'enabled',
      schedule_expression: '0 8 * * 1',
      automation_id: null,
      trigger_source: null,
      created_by: 'user_1',
      last_run_time: null,
    },
  ],
  set_trigger_status: vi.fn(),
  relative_time: () => 'just now',
}));
vi.mock('@/components/app/automations/new_automation_sheet', () => ({
  NewAutomationSheet: () => null,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: { children?: ReactNode; to?: string; params?: object }) =>
    createElement('a', { 'data-to': to, 'data-params': JSON.stringify(params ?? {}) }, children),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { AutomationsPage } from '@/components/app/automations/automations_page';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(AutomationsPage)));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function rows() {
  return [...container.querySelectorAll('li')].map((row) => {
    const name = row.querySelector('a')?.textContent ?? '';
    const pill = row.querySelector('button')?.textContent ?? '';
    return pill ? `${name} | ${pill}` : name;
  });
}

async function click_filter(label: string) {
  const filter = [...container.querySelectorAll('button[aria-pressed]')].find((button) =>
    button.textContent?.startsWith(label),
  );
  if (!(filter instanceof HTMLElement)) throw new Error(`no filter ${label}`);
  await act(async () => filter.click());
}

it('says on every row what kind it is, with no Scheduled tasks heading', () => {
  expect(rows()).toEqual([
    'Build a billion-dollar company | Goal',
    'Answer new mail | Trigger',
    'Monday digest | Scheduled',
    'Monday Leadership Report | Scheduled',
  ]);
  expect(container.textContent).not.toMatch(/scheduled tasks/i);
});

it('counts each kind across automations and the older scheduled tasks', () => {
  const filters = [...container.querySelectorAll('button[aria-pressed]')].map(
    (button) => button.textContent,
  );
  expect(filters).toEqual(['All4', 'Triggers1', 'Scheduled2', 'Goals1']);
});

it('narrows the list to one kind and stops repeating the kind on the rows', async () => {
  await click_filter('Scheduled');
  expect(rows()).toEqual(['Monday digest', 'Monday Leadership Report']);

  await click_filter('All');
  expect(rows()).toHaveLength(4);
});

it('says what each one does in the first line of its instruction', () => {
  expect(container.textContent).toContain('Handle Answer new mail.');
  expect(container.textContent).not.toContain('Second line stays off the list.');
});

it('narrows the list by name from the search box', async () => {
  const box = container.querySelector<HTMLInputElement>('[aria-label="Search automations"]');
  if (!box) throw new Error('no search box');
  await act(async () => {
    const set_value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set_value?.call(box, 'monday');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(rows()).toEqual(['Monday digest | Scheduled', 'Monday Leadership Report | Scheduled']);
});

it('narrows the list from the pill on a row', async () => {
  const goal_pill = [...container.querySelectorAll('li button')].find(
    (button) => button.textContent === 'Goal',
  );
  if (!(goal_pill instanceof HTMLElement)) throw new Error('no goal pill');
  await act(async () => goal_pill.click());
  expect(rows()).toEqual(['Build a billion-dollar company']);
});

it('keeps every kind on the filter row and says so when a kind has none', async () => {
  await click_filter('All');
  const box = container.querySelector<HTMLInputElement>('[aria-label="Search automations"]');
  if (!box) throw new Error('no search box');
  await act(async () => {
    const set_value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set_value?.call(box, 'no such automation');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(rows()).toEqual([]);
  expect(container.textContent).toContain('Nothing matches "no such automation".');
});

it('opens an older scheduled task as an automation', () => {
  const link = [...container.querySelectorAll('li a')].find(
    (anchor) => anchor.textContent === 'Monday Leadership Report',
  );
  expect(link?.getAttribute('data-to')).toBe('/automations/$automation_id');
  expect(JSON.parse(link?.getAttribute('data-params') ?? '{}')).toEqual({
    automation_id: 'trg_report',
  });
});
