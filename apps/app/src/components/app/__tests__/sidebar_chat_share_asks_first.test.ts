// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readers_of_room } from '@/components/app/chat_room_label';
import { SidebarChatLink } from '@/components/app/sidebar_chat_link';
import { query_keys } from '@/lib/api/query_keys';
import { team_viewer_role_query_key } from '@/lib/api/team_mode';
import type { Project, Session } from '@/lib/api/types';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ href, children, ...anchor }: { href?: string; children?: ReactNode }) =>
    createElement('a', { ...anchor, href }, children),
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: '/chats' }),
  useNavigate: () => vi.fn(),
}));

function project(project_id: string, project_name: string, flags: Partial<Project> = {}) {
  return {
    project_id,
    project_name,
    project_access: 'members',
    personal_for_user_id: null,
    is_workspace_default: false,
    ...flags,
  } as Project;
}

const own_room = project('proj_own', 'Personal', {
  project_access: 'private',
  personal_for_user_id: 'usr_owner',
});
const launch = project('proj_launch', 'Launch');
const whole_workspace = project('proj_all', 'Acme', {
  project_access: 'workspace',
  is_workspace_default: true,
});

const private_chat = {
  session_id: 'ses_1',
  session_title: 'Salary notes',
  session_source: 'dashboard',
  session_status: 'completed',
  project_id: own_room.project_id,
  reader_may_move_or_delete_it: true,
  created_time: '2026-07-10T09:00:00.000Z',
  last_updated_time: '2026-07-10T10:00:00.000Z',
  last_message_time: '2026-07-10T09:59:00.000Z',
} as Session;

let root: Root | null = null;
let client: QueryClient;
let moves: unknown[];

function show_the_row(input: { team_role: string | null; chat?: Session }) {
  const chat = input.chat ?? private_chat;
  client.setQueryData(team_viewer_role_query_key, input.team_role);
  client.setQueryData(query_keys.sessions(), [chat]);
  const row = createElement(SidebarChatLink, {
    isActive: false,
    session: chat,
    project_label: 'Acme Team',
  });
  act(() => root?.render(createElement(QueryClientProvider, { client }, row)));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  moves = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname.replace(/^.*(?=\/v1\/)/u, '');
    if (path.endsWith('/v1/projects')) {
      return Response.json({ data: [own_room, launch, whole_workspace] });
    }
    if (path.endsWith('/v1/workspace')) {
      return Response.json({ data: { workspace_name: 'Acme Team' } });
    }
    const body = request.method === 'PATCH' ? await request.json() : null;
    if (body) moves.push(body);
    return Response.json({ data: { ...private_chat, ...(body as object), connections_lost: [] } });
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
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

function menu_items() {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

async function open_the_row_menu() {
  await click(
    document.querySelector<HTMLElement>('[aria-label="Rename or move chat Salary notes"]'),
    'the row menu',
  );
}

async function choose(menu_item_text: string) {
  await open_the_row_menu();
  await click(
    menu_items().find((item) => item.textContent === menu_item_text),
    `menu item ${menu_item_text}`,
  );
}

function dialog() {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

function dialog_button(text: string) {
  return [...(dialog()?.querySelectorAll<HTMLElement>('button') ?? [])].find(
    (button) => button.textContent === text,
  );
}

function place_of_the_chat() {
  return client.getQueryData<Session[]>(query_keys.sessions())?.[0]?.project_id;
}

describe('moving a private chat where other people read it, on an install a team signs in to', () => {
  it('asks first, says who will read the chat, and moves nothing yet', async () => {
    show_the_row({ team_role: 'owner' });
    await choose('Acme Team');

    expect(dialog()?.textContent).toContain('Share “Salary notes”?');
    expect(dialog()?.textContent).toContain(
      'Everyone in Acme Team will be able to read this chat.',
    );
    expect(document.activeElement?.textContent).toBe('Cancel');
    expect(moves).toEqual([]);
    expect(place_of_the_chat()).toBe(own_room.project_id);
  });

  it('keeps the chat private when the person cancels', async () => {
    show_the_row({ team_role: 'owner' });
    await choose('Acme Team');
    await click(dialog_button('Cancel'), 'Cancel');

    expect(moves).toEqual([]);
    expect(place_of_the_chat()).toBe(own_room.project_id);
  });

  it('moves the chat with the yes when the person confirms', async () => {
    show_the_row({ team_role: 'owner' });
    await choose('Acme Team');
    await click(dialog_button('Share the chat'), 'Share the chat');

    expect(moves).toEqual([{ project_id: 'proj_all', share_with_its_readers: true }]);
  });

  it('names the project when only its people will read the chat', async () => {
    show_the_row({ team_role: 'member' });
    await choose('Launch');

    expect(dialog()?.textContent).toContain(
      'Everyone in the project Launch will be able to read this chat.',
    );
  });

  it('moves a shared chat back to the person own room at once, with no question', async () => {
    show_the_row({
      team_role: 'owner',
      chat: { ...private_chat, project_id: whole_workspace.project_id },
    });
    await choose('Personal');

    expect(dialog()).toBeNull();
    expect(moves).toEqual([{ project_id: 'proj_own' }]);
  });
});

describe('moving a chat on an install of any other mode', () => {
  it('moves at once and sends no yes, as before', async () => {
    show_the_row({ team_role: null });
    await choose('Acme Team');

    expect(dialog()).toBeNull();
    expect(moves).toEqual([{ project_id: 'proj_all' }]);
  });
});

describe('the row of a chat other people read', () => {
  const shared_chat = { ...private_chat, project_id: whole_workspace.project_id } as Session;
  const mark = () =>
    document.querySelector('[aria-label="Everyone in Acme Team can read this chat"]');

  it('shows who reads it without a hover, where chats are private by default', () => {
    show_the_row({ team_role: 'member', chat: shared_chat });

    expect(mark()).not.toBeNull();
  });

  it('shows no such mark on an install of any other mode', () => {
    show_the_row({ team_role: null, chat: shared_chat });

    expect(mark()).toBeNull();
  });

  it('offers a reader who may not change it no new name, no move and no delete', () => {
    show_the_row({
      team_role: 'member',
      chat: { ...shared_chat, reader_may_move_or_delete_it: false },
    });

    expect(document.querySelector('a[href="/chats/ses_1"]')?.textContent).toContain('Salary notes');
    expect(document.querySelector('[aria-label="Rename or move chat Salary notes"]')).toBeNull();
    expect(document.querySelector('[aria-label="Delete chat Salary notes"]')).toBeNull();
    expect(menu_items()).toEqual([]);
  });

  it('offers the person who may the projects and the delete', async () => {
    show_the_row({ team_role: 'owner', chat: shared_chat });
    await open_the_row_menu();

    expect(menu_items().map((item) => item.textContent)).toEqual([
      'Rename',
      'Personal',
      'Launch',
      'Delete',
    ]);
    expect(document.querySelector('[aria-label="Delete chat Salary notes"]')).not.toBeNull();
  });
});

describe('the project badge of a chat row', () => {
  it('comes after the title on a line that wraps it out of sight, so no title is cut for it', () => {
    show_the_row({ team_role: null });
    const badge = document.querySelector<HTMLElement>('a [title="Acme Team"]');
    const line = badge?.parentElement;
    const title_and_marks = line?.firstElementChild;

    expect(badge?.textContent).toBe('Acme Team');
    expect([...(line?.classList ?? [])]).toEqual(
      expect.arrayContaining(['flex-wrap', 'h-5', 'overflow-hidden']),
    );
    expect(line?.lastElementChild).toBe(badge);
    expect(title_and_marks).not.toBe(badge);
    expect(title_and_marks?.textContent).toContain('Salary notes');
    expect([...(title_and_marks?.classList ?? [])]).toContain('flex-auto');
  });
});

describe('who reads the chats of a project', () => {
  it('is nobody else for a person own room, the project people, or the whole workspace', () => {
    expect(readers_of_room(own_room, 'Acme Team')).toBeNull();
    expect(readers_of_room(launch, 'Acme Team')).toBe('Everyone in the project Launch');
    expect(readers_of_room(whole_workspace, 'Acme Team')).toBe('Everyone in Acme Team');
    expect(readers_of_room(whole_workspace)).toBe('Everyone in this workspace');
  });
});
