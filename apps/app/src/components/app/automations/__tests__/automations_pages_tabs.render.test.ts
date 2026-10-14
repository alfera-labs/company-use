// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children?: ReactNode; to?: string }) =>
    createElement(
      'a',
      { href: to, 'aria-current': (rest as { 'aria-current'?: string })['aria-current'] },
      children,
    ),
  createFileRoute: () => (options: unknown) => ({ options }),
}));
const list_automations = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));
vi.mock('@/components/app/automations/automations_api', () => ({
  list_automations,
  list_trigger_types: async () => ({ count: 0, apps: [] }),
  set_automation_status: vi.fn(),
  list_notifications: async () => ({ items: [] }),
  end_notification: vi.fn(),
  read_notification_rules: async () => ({
    policy: {
      dial: 'normal',
      max_notifications_per_day: 5,
      quiet_hours: null,
      delivery_channel_order: ['slack_dm'],
      daily_summary_cadence: 'weekdays',
      daily_summary_at_time: '07:45',
    },
    guidance: '',
    policy_hash: 'h1',
  }),
  save_notification_rules: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  list_triggers: async () => [],
  relative_time: () => 'just now',
}));
vi.mock('@/lib/page_title', () => ({ page_title: (name: string) => name }));

import { AttentionActivityPage } from '@/components/app/automations/attention_activity_page';
import { AutomationsPage } from '@/components/app/automations/automations_page';
import { Route as NotificationsRoute } from '@/routes/_workspace/automations/notifications';

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

async function mount(page: () => ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(page)));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function current_page() {
  const bar = container.querySelector('nav[aria-label="Automations pages"]');
  return bar?.querySelector('[aria-current="page"]')?.textContent ?? null;
}

const notifications_page = (
  NotificationsRoute as unknown as { options: { component: () => ReactNode } }
).options.component;

describe('each Automations page', () => {
  it('shows the bar on the list, with Automations marked', async () => {
    await mount(AutomationsPage);
    expect(current_page()).toBe('Automations');
  });

  it('shows the bar on Activity, with Activity marked and no back link of its own', async () => {
    await mount(AttentionActivityPage);
    expect(current_page()).toBe('Activity');
    const links = [...container.querySelectorAll('a')].filter(
      (a) => a.textContent === 'Automations',
    );
    expect(links).toHaveLength(1);
  });

  it('shows the bar on Notifications, with Notifications marked and the settings under it', async () => {
    await mount(notifications_page);
    expect(current_page()).toBe('Notifications');
    expect(container.textContent).toContain('Notify me');
  });
});

describe('the list row', () => {
  it("names the app a trigger waits on with the app's own name", async () => {
    list_automations.mockResolvedValueOnce([
      {
        automation_id: 'atm_1',
        automation_name: 'Lead intake',
        automation_status: 'enabled',
        instruction: 'Answer the lead.',
        last_run_time: null,
        triggers: [
          {
            trigger_id: 'trg_1',
            trigger_type: 'app_event',
            trigger_name: 'Mail arrives',
            trigger_config: { needs_connection: 'composio_gmail' },
            app: { app_name: 'composio_gmail', app_display_name: 'Gmail', icon_url: null },
          },
        ],
      },
    ]);
    await mount(AutomationsPage);
    expect(container.textContent).toContain('Connect Gmail to start');
    expect(container.textContent).not.toContain('composio_gmail');
  });
});
