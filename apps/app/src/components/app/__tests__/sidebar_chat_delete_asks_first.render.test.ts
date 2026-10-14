// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarChatLink } from '@/components/app/sidebar_chat_link';
import { query_keys } from '@/lib/api/query_keys';
import type { Session } from '@/lib/api/types';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ href, children, ...anchor }: { href?: string; children?: ReactNode }) =>
    createElement('a', { ...anchor, href }, children),
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: '/chats' }),
  useNavigate: () => vi.fn(),
}));

const chat = {
  session_id: 'ses_1',
  session_title: 'Workflow discovery',
  session_source: 'dashboard',
  session_status: 'completed',
  project_id: 'proj_sales',
  created_time: '2026-07-10T09:00:00.000Z',
  last_updated_time: '2026-07-10T10:00:00.000Z',
  last_message_time: '2026-07-10T09:59:00.000Z',
} as Session;

let root: Root | null = null;
let client: QueryClient;
let delete_requests: string[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  delete_requests = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname.replace(/^.*(?=\/v1\/)/u, '');
    if (request.method === 'DELETE') delete_requests.push(path);
    if (path.endsWith('/v1/projects')) return Response.json({ data: [] });
    return Response.json({ data: chat });
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(query_keys.sessions(), [chat]);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(SidebarChatLink, { isActive: false, session: chat }),
      ),
    ),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function click(element: HTMLElement | null | undefined, name: string) {
  expect(element, name).toBeTruthy();
  await act(async () => element?.click());
  await settle();
}

function delete_x() {
  return document.querySelector<HTMLElement>('[aria-label="Delete chat Workflow discovery"]');
}

function dialog() {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

function dialog_button(text: string) {
  return [...(dialog()?.querySelectorAll<HTMLElement>('button') ?? [])].find(
    (button) => button.textContent === text,
  );
}

function chats_in_the_list() {
  return client.getQueryData<Session[]>(query_keys.sessions())?.map((one) => one.session_id);
}

describe('deleting a chat from its sidebar row', () => {
  it('asks first, with the focus on Cancel, and deletes nothing yet', async () => {
    await click(delete_x(), 'the delete button');

    expect(dialog()?.textContent).toContain('Delete “Workflow discovery”?');
    expect(document.activeElement?.textContent).toBe('Cancel');
    expect(delete_requests).toEqual([]);
    expect(chats_in_the_list()).toEqual(['ses_1']);
  });

  it('keeps the chat when the person cancels', async () => {
    await click(delete_x(), 'the delete button');
    await click(dialog_button('Cancel'), 'Cancel');

    expect(delete_requests).toEqual([]);
    expect(chats_in_the_list()).toEqual(['ses_1']);
  });

  it('deletes the chat when the person confirms', async () => {
    await click(delete_x(), 'the delete button');
    await click(dialog_button('Delete chat'), 'Delete chat');

    expect(delete_requests).toEqual(['/v1/sessions/ses_1']);
  });

  it('offers Delete inside the row menu, and that path asks first too', async () => {
    await click(
      document.querySelector<HTMLElement>('[aria-label="Rename or move chat Workflow discovery"]'),
      'the row menu',
    );
    const delete_item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'Delete',
    );
    await click(delete_item, 'the Delete menu item');

    expect(dialog()?.textContent).toContain('Delete “Workflow discovery”?');
    expect(delete_requests).toEqual([]);
  });

  it('hides the X on a narrow screen, where the menu holds Delete', () => {
    expect(delete_x()?.className).toContain('max-md:hidden');
  });
});
