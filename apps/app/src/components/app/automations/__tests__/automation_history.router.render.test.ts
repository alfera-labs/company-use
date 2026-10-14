// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AutomationHistory } from '@/components/app/automations/automation_history';

const fire = {
  trigger_id: 'trg_1',
  reason: null,
  skipped: null,
  judge: null,
  budget_limit: null,
  triage: null,
  subject_source: null,
  told: null,
};
const fires = [
  {
    ...fire,
    event_id: 'evt_working',
    fired_time: '2026-09-29T15:46:00.000Z',
    trigger_name: 'Ticket arrives',
    outcome: 'running',
    run_id: 'run_working',
    session_id: 'ses_working',
  },
  {
    ...fire,
    event_id: 'evt_queued',
    fired_time: '2026-09-29T15:00:00.000Z',
    trigger_name: 'Ticket queued',
    outcome: 'waiting',
    run_id: null,
    session_id: null,
  },
];

async function answer_api_request(input: RequestInfo | URL, init?: RequestInit) {
  const path = new URL(new Request(input, init).url).pathname;
  if (path.endsWith('/v1/automations/atm_1/fires')) {
    return Response.json({ data: { items: fires, total_count: 2, page: 1, page_size: 20 } });
  }
  if (path.endsWith('/v1/notifications')) {
    return Response.json({ data: { items: [], total_count: 0, page: 1, page_size: 20 } });
  }
  return new Promise<Response>(() => undefined);
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(answer_api_request));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function build_router() {
  const root_route = createRootRoute({ component: () => createElement(Outlet) });
  const history_page = createRoute({
    getParentRoute: () => root_route,
    path: '/automations/$automation_id',
    component: () => createElement(AutomationHistory, { automationId: 'atm_1', summaryTime: '' }),
  });
  const chat_page = createRoute({
    getParentRoute: () => root_route,
    path: '/chats/{-$session_id}',
    component: () => 'the chat',
  });
  return createRouter({
    routeTree: root_route.addChildren([history_page, chat_page]),
    history: createMemoryHistory({ initialEntries: ['/automations/atm_1'] }),
  });
}

async function render_history() {
  const router = build_router();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    await router.load();
    root.render(
      createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router })),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return router;
}

it('opens the chat of a run that is still working, and says Working', async () => {
  const router = await render_history();
  const rows = [...container.querySelectorAll('tbody tr')];

  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining('Working'),
    expect.stringContaining('Waiting'),
  ]);
  const links = [...container.querySelectorAll('tbody a')];
  expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
    ['Ticket arrives', '/chats/ses_working'],
  ]);

  await act(async () => {
    (rows[0]?.querySelector('td:last-child') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(router.state.location.pathname).toBe('/chats/ses_working');
});
