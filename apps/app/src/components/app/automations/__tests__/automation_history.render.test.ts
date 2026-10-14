// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) =>
    createElement('a', { href: to }, children),
  useNavigate: () => vi.fn(),
}));
const list_notifications = vi.hoisted(() =>
  vi.fn(async () => ({
    items: [
      {
        event_id: 'evt_quiet',
        outcome: 'drop_with_reason',
        created_time: '2026-09-20T09:00:00.000Z',
        notification: {
          title: 'Newsletter from Acme',
          outcome_reason: 'A newsletter is not news.',
          session_id: null,
        },
      },
      {
        event_id: 'evt_parked',
        outcome: 'add_to_ideas_list',
        created_time: '2026-09-20T08:00:00.000Z',
        notification: {
          title: 'Track Acme renewals',
          outcome_reason: 'Worth an automation of its own.',
          session_id: null,
        },
      },
    ],
  })),
);
vi.mock('@/components/app/automations/automations_api', () => ({
  list_automation_fires: async () => ({ items: [] }),
  list_notifications,
}));
vi.mock('@/lib/api', () => ({ relative_time: () => 'just now' }));

import { AutomationHistory } from '@/components/app/automations/automation_history';

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

describe('the run history', () => {
  it('shows a quiet notification of this automation as a row with its reason', async () => {
    await render_history();

    expect(list_notifications).toHaveBeenCalledWith({ automation_id: 'atm_1', page_size: 20 });
    const rows = [...container.querySelectorAll('tbody tr')].map((row) => row.textContent);
    expect(rows).toEqual([
      'Newsletter from Acmejust nowStayed quiet: A newsletter is not news.',
      'Track Acme renewalsjust nowParked on Ideas: Worth an automation of its own.',
    ]);
    expect(container.textContent).not.toContain('Listening');
  });

  it('links a parked row to the Ideas page, and no other row', async () => {
    await render_history();
    const to_ideas = [...container.querySelectorAll('a[href="/automations/ideas"]')];
    expect(to_ideas.map((link) => link.textContent)).toEqual([
      'Parked on Ideas: Worth an automation of its own.',
    ]);
  });
});

async function render_history() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(AutomationHistory, { automationId: 'atm_1', summaryTime: undefined }),
      ),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
