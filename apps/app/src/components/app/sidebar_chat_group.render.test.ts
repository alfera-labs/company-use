import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatRoomGroup } from '@/components/app/chat_room_groups';
import { SidebarChatGroup } from '@/components/app/sidebar_chat_group';
import { SidebarChatRooms } from '@/components/app/sidebar_chat_rooms';
import type { Session } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import type { Project } from '@/lib/api/types';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, params, preload, href, children, ...anchor }: StubLinkProps) =>
    createElement('a', { ...anchor, href: href ?? stub_link_href(to ?? '', params) }, children),
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: '/chats/ses_open' }),
  useNavigate: () => vi.fn(),
}));

function chat(session_id: string, session_title: string): Session {
  return {
    session_id,
    workspace_id: 'ws_1',
    agent_id: 'agt_1',
    project_id: 'proj_mkt',
    session_title,
    session_status: 'active',
    session_source: 'dashboard',
    created_time: '2026-09-01T00:00:00Z',
    last_updated_time: '2026-09-01T00:00:00Z',
    last_message_time: '2026-09-01T00:00:00Z',
  } as Session;
}

function render_group(group: ChatRoomGroup) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(SidebarChatGroup, { group }),
    ),
  );
}

const marketing: ChatRoomGroup = {
  group_key: 'proj_mkt',
  group_name: 'Marketing',
  group_kind: 'project',
  project_id: 'proj_mkt',
  sessions: [chat('ses_open', 'Fall promo subject lines'), chat('ses_other', 'Pricing page')],
};

describe('a room in the sidebar', () => {
  it('names the room, counts its chats, and lists them', () => {
    const html = render_group(marketing);
    expect(html).toContain('Marketing');
    expect(html).toContain('>2<');
    expect(html).toContain('Fall promo subject lines');
    expect(html).toContain('Pricing page');
  });

  it('opens a shared room from its name', () => {
    expect(render_group(marketing)).toContain('href="/projects/proj_mkt"');
  });

  it('offers to start a chat already in the room', () => {
    expect(render_group(marketing)).toContain('aria-label="New chat in Marketing"');
  });

  it('does not link a room with no page behind it', () => {
    const html = render_group({
      group_key: 'proj_mine',
      group_name: 'Personal',
      group_kind: 'personal',
      project_id: 'proj_mine',
      sessions: [chat('ses_note', 'Draft my 1:1 notes')],
    });
    expect(html).toContain('Personal');
    expect(html).not.toContain('href="/projects/proj_mine"');
  });

  it('says so rather than showing an empty room', () => {
    const html = render_group({ ...marketing, sessions: [] });
    expect(html).toContain('No chats yet');
  });
});

function sidebar_project(project_id: string, overrides: Partial<Project> = {}): Project {
  return {
    project_id,
    workspace_id: 'ws_1',
    project_name: project_id,
    project_status: 'active',
    project_access: 'members',
    is_workspace_default: false,
    project_description: null,
    project_instructions: null,
    membership_version: 1,
    personal_for_user_id: null,
    created_time: '2026-09-01T00:00:00Z',
    last_updated_time: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function render_recent_sidebar() {
  const client = new QueryClient();
  const projects = [
    ...['Launch', 'Sales', 'Research', 'Operations', 'Archive'].map((name) =>
      sidebar_project(name, name === 'Launch' ? { project_name: 'Personal' } : {}),
    ),
    sidebar_project('personal', { personal_for_user_id: 'user_1' }),
    sidebar_project('company', { is_workspace_default: true }),
  ];
  const sessions = [
    {
      ...chat('old_custom', 'Custom chat'),
      project_id: 'Launch',
      last_message_time: '2026-09-09T08:00:00Z',
      last_updated_time: '2026-09-09T14:00:00Z',
    },
    {
      ...chat('company_chat', 'Company chat'),
      project_id: 'company',
      last_message_time: '2026-09-09T10:00:00Z',
    },
    {
      ...chat('personal_chat', 'Personal chat'),
      project_id: 'personal',
      last_message_time: null,
      last_updated_time: '2026-09-09T11:00:00Z',
    },
    {
      ...chat('legacy_chat', 'Legacy chat'),
      project_id: null,
      last_message_time: '2026-09-09T09:00:00Z',
    },
    {
      ...chat('unknown_chat', 'Unknown project chat'),
      project_id: 'missing',
      last_message_time: '2026-09-09T12:00:00Z',
    },
  ];
  client.setQueryData(query_keys.projects(''), projects);
  client.setQueryData(query_keys.sessions(), sessions);
  client.setQueryData(query_keys.workspace(), { workspace_name: 'Alfera' });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(SidebarChatRooms)),
  );
}

describe('the unified recent sidebar', () => {
  it('keeps every chat and sorts by the latest message before the update time', () => {
    const html = render_recent_sidebar();
    const ids = [...html.matchAll(/href="\/chats\/([^"/]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual([
      'unknown_chat',
      'personal_chat',
      'company_chat',
      'legacy_chat',
      'old_custom',
    ]);
  });

  it('keeps project context in each chat description', () => {
    const html = render_recent_sidebar();
    expect(html).toContain('title="Personal chat · Web · Personal · Read · ');
    expect(html).toContain('title="Company chat · Web · Alfera · Read · ');
    expect(html).toContain('title="Legacy chat · Web · Alfera · Read · ');
    expect(html).toContain('title="Custom chat · Web · Personal · Read · ');
    expect(html).toContain('title="Unknown project chat · Web · Project · Read · ');
    expect(html).toContain('hidden max-w-full');
    expect(html).toContain('lucide-building-2');
    const shared_personal =
      html.match(/href="\/chats\/old_custom"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '';
    const personal = html.match(/href="\/chats\/personal_chat"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '';
    expect(shared_personal).toContain('md:group-hover/chat-row:block');
    expect(personal).not.toContain('md:group-hover/chat-row:block');
  });

  it('starts open with four company-first shortcuts and a link to all projects', () => {
    const html = render_recent_sidebar();
    const ids = [...html.matchAll(/href="\/projects\/([^"/]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual(['company', 'Launch', 'Sales', 'Research']);
    expect(html).toContain('href="/projects"');
    expect(html).toContain('View all');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('id="sidebar-project-shortcuts"');
    expect(html).not.toContain('id="sidebar-project-shortcuts" hidden=""');
    expect(html).toContain('aria-label="Filter recent chats by project"');
  });
});

type StubLinkProps = {
  to?: string;
  href?: string;
  params?: Record<string, string> | undefined;
  preload?: unknown;
  children?: ReactNode;
  [key: string]: unknown;
};

function stub_link_href(to: string, params: Record<string, string> | undefined) {
  return to
    .replace(/\{-\$(\w+)\}/gu, (_segment, key: string) => params?.[key] ?? '')
    .replace(/\$(\w+)/gu, (_segment, key: string) => params?.[key] ?? '')
    .replace(/\/$/u, '');
}
