// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projects_to_move_into } from '@/components/app/sidebar_chat_actions';
import { SidebarChatLink } from '@/components/app/sidebar_chat_link';
import {
  chats_after_move,
  chats_after_rename,
  name_to_save,
} from '@/components/app/use_sidebar_chat_actions';
import { query_keys } from '@/lib/api/query_keys';
import type { Project, Session } from '@/lib/api/types';

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
  session_status: 'active',
  project_id: 'proj_sales',
  created_time: '2026-07-10T09:00:00.000Z',
  last_updated_time: '2026-07-10T10:00:00.000Z',
  last_message_time: '2026-07-10T09:59:00.000Z',
} as Session;

function project(project_id: string, project_name: string, flags: Partial<Project> = {}) {
  return {
    project_id,
    project_name,
    personal_for_user_id: null,
    is_workspace_default: false,
    ...flags,
  } as Project;
}

const sales = project('proj_sales', 'Sales');
const launch = project('proj_launch', 'Launch');
const whole_workspace = project('proj_all', 'Acme', { is_workspace_default: true });

let root: Root | null = null;
let client: QueryClient;
let requests: { method: string; path: string; body: unknown }[];
let listed_projects: Project[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  requests = [];
  listed_projects = [sales, launch];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname.replace(/^.*(?=\/v1\/)/u, '');
    const body = request.method === 'GET' ? null : await request.json();
    requests.push({ method: request.method, path, body });
    if (path.endsWith('/v1/projects')) return Response.json({ data: listed_projects });
    if (path.endsWith('/v1/workspace')) {
      return Response.json({ data: { workspace_name: 'Acme Team' } });
    }
    return Response.json({ data: { ...chat, ...(body as object), connections_lost: [] } });
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

async function open_the_row_menu() {
  const trigger = document.querySelector<HTMLElement>(
    '[aria-label="Rename or move chat Workflow discovery"]',
  );
  await act(async () => trigger?.click());
  await settle();
}

async function choose(menu_item_text: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (one) => one.textContent === menu_item_text,
  );
  expect(item, `menu item ${menu_item_text}`).toBeDefined();
  await act(async () => item?.click());
  await settle();
}

function name_field() {
  return document.querySelector<HTMLInputElement>(
    '[aria-label="New name for chat Workflow discovery"]',
  );
}

async function type_a_name(name: string) {
  const field = name_field();
  const set_value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    set_value?.call(field, name);
    field?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press(key: 'Enter' | 'Escape') {
  const field = name_field();
  await act(async () => {
    field?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    if (key === 'Enter') field?.form?.requestSubmit();
  });
  await settle();
}

function saved_chat() {
  return client.getQueryData<Session[]>(query_keys.sessions())?.[0];
}

describe('renaming a chat from its sidebar row', () => {
  it('turns the name into a focused text field that holds the name', async () => {
    await open_the_row_menu();
    await choose('Rename');

    expect(name_field()?.value).toBe('Workflow discovery');
    expect(document.activeElement).toBe(name_field());
  });

  it('saves the typed name on Enter', async () => {
    await open_the_row_menu();
    await choose('Rename');
    await type_a_name('Q3 pricing plan');
    await press('Enter');

    expect(requests).toContainEqual({
      method: 'PATCH',
      path: '/v1/sessions/ses_1',
      body: { session_title: 'Q3 pricing plan' },
    });
    expect(name_field()).toBeNull();
  });

  it('changes nothing on Escape', async () => {
    await open_the_row_menu();
    await choose('Rename');
    await type_a_name('Never saved');
    await press('Escape');

    expect(requests.filter((request) => request.method === 'PATCH')).toEqual([]);
    expect(name_field()).toBeNull();
    expect(saved_chat()?.session_title).toBe('Workflow discovery');
  });
});

describe('moving a chat from its sidebar row', () => {
  it('lists the other projects and moves the chat into the one chosen', async () => {
    await open_the_row_menu();

    const items = [...document.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent,
    );
    expect(items).toEqual(['Rename', 'Launch', 'Delete']);
    expect(document.body.textContent).toContain('Move to project');

    await choose('Launch');

    expect(requests).toContainEqual({
      method: 'PATCH',
      path: '/v1/sessions/ses_1',
      body: { project_id: 'proj_launch' },
    });
  });

  it('calls the shared project by the name of the workspace, as the sidebar does', async () => {
    listed_projects = [sales, launch, whole_workspace];
    await open_the_row_menu();

    const items = [...document.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent,
    );
    expect(items).toEqual(['Rename', 'Launch', 'Acme Team', 'Delete']);
  });
});

describe('what a row change does to the list of chats', () => {
  it('renames and moves only the chat that was changed', () => {
    const other = { ...chat, session_id: 'ses_2' };

    expect(chats_after_rename([chat, other], 'ses_1', 'New name')).toEqual([
      { ...chat, session_title: 'New name' },
      other,
    ]);
    expect(chats_after_move([chat, other], 'ses_1', 'proj_launch')).toEqual([
      { ...chat, project_id: 'proj_launch' },
      other,
    ]);
  });

  it('saves a trimmed name, and saves nothing for an empty or unchanged one', () => {
    expect(name_to_save('  Q3 plan  ', 'Old')).toBe('Q3 plan');
    expect(name_to_save('   ', 'Old')).toBeNull();
    expect(name_to_save('Old', 'Old')).toBeNull();
    expect(name_to_save('x'.repeat(200), 'Old')).toHaveLength(160);
  });

  it('offers every project but the one the chat is in', () => {
    const projects = [sales, launch, whole_workspace];

    expect(projects_to_move_into(projects, 'proj_sales')).toEqual([launch, whole_workspace]);
    expect(projects_to_move_into(projects, null)).toEqual([sales, launch]);
  });
});
