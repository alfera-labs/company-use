// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) =>
    createElement('a', { href: to }, children),
}));
const notification = (
  event_id: string,
  outcome: string,
  outcome_reason: string,
  held: unknown = null,
) => ({
  event_id,
  outcome,
  is_open: false,
  created_time: '2026-09-20T09:00:00.000Z',
  notification: {
    title: `Title ${event_id}`,
    body: 'Body',
    outcome_reason,
    automation_id: 'atm_1',
    session_id: null,
    policy_hash: 'hash_abc123',
    held,
  },
});
vi.mock('@/components/app/automations/automations_api', () => ({
  list_notifications: async () => ({
    items: [
      notification('evt_told', 'notify_now', 'it asks for a decision'),
      notification('evt_held', 'add_to_daily_summary', 'it can wait for the morning'),
      notification('evt_quiet', 'drop_with_reason', 'a newsletter is not news'),
      notification('evt_parked', 'add_to_ideas_list', 'worth an automation of its own'),
      notification('evt_quiet_hours', 'add_to_daily_summary', 'raw words from the run', {
        kind: 'quiet_hours',
      }),
    ],
  }),
  list_automations: async () => [
    {
      automation_id: 'atm_1',
      automation_name: 'Lead intake',
      triggers: [
        { app: { app_name: 'composio_gmail', app_display_name: 'Gmail', icon_url: null } },
        { app: { app_name: 'composio_gmail', app_display_name: 'Gmail', icon_url: null } },
        { app: null },
      ],
    },
  ],
  end_notification: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ relative_time: () => 'just now' }));

import { AttentionActivityPage } from '@/components/app/automations/attention_activity_page';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client }, createElement(AttentionActivityPage)),
    );
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

describe('the Activity rows', () => {
  it('says the reason only on rows that went nowhere, never the policy hash', () => {
    const text = container.textContent ?? '';
    expect(text).toContain('a newsletter is not news');
    expect(text).toContain('worth an automation of its own');
    expect(text).not.toContain('it asks for a decision');
    expect(text).not.toContain('it can wait for the morning');
    expect(text).not.toContain('hash_abc123');
  });

  it('name the automation and each of its apps once', () => {
    const line = container.querySelector('a[href="/automations/$automation_id"]');
    expect(line?.textContent).toBe('Lead intake · Gmail');
  });

  it('link a parked row to the Ideas page, and no other row', () => {
    const to_ideas = [...container.querySelectorAll('a[href="/automations/ideas"]')];
    expect(to_ideas.map((link) => link.textContent)).toEqual(['Parked']);
  });

  it("say a hold under its summary row, in the words the API names, not the run's raw line", () => {
    const row = row_for('evt_quiet_hours');
    expect(row.textContent).toContain('Saved for the summary');
    const subtitle = row.querySelector('p[title]');
    expect(subtitle?.textContent).toBe('held for quiet hours');
    expect(row.textContent).not.toContain('raw words from the run');
    expect(row_for('evt_held').querySelector('p[title]')).toBeNull();
  });

  it('offers Done/Dismiss/Answered only on rows that reached you or are waiting, none on quiet rows', () => {
    expect(row_for('evt_told').textContent).toContain('Answered');
    expect(row_for('evt_held').textContent).toContain('Answered');
    expect(row_for('evt_quiet').textContent).not.toContain('Answered');
    expect(row_for('evt_parked').textContent).not.toContain('Answered');
  });
});

function row_for(event_id: string) {
  const title = [...container.querySelectorAll('span.font-medium')].find(
    (span) => span.textContent === `Title ${event_id}`,
  );
  const row = title?.closest('li');
  if (!row) throw new Error(`no row for ${event_id}`);
  return row;
}
