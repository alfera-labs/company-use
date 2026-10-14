import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { people_not_in_project } from '@/components/app/project_add_people_menu';
import { ProjectHomePage } from '@/components/app/project_home_page';
import type { WorkspaceMember } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Project, ProjectMember, Session } from '@/lib/api/types';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, params, preload, href, children, ...anchor }: StubLinkProps) =>
    createElement('a', { ...anchor, href: href ?? stub_link_href(to ?? '', params) }, children),
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: '/projects/proj_mkt' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@coworker/ui/components/dropdown-menu', () => {
  const box = (children: ReactNode) => createElement('div', null, children);
  return {
    DropdownMenu: ({ children }: { children?: ReactNode }) => box(children),
    DropdownMenuTrigger: ({ render }: { render?: ReactNode }) => box(render),
    DropdownMenuContent: ({ children }: { children?: ReactNode }) => box(children),
    DropdownMenuItem: ({ children }: { children?: ReactNode }) => box(children),
    DropdownMenuLabel: ({ children }: { children?: ReactNode }) => box(children),
  };
});

const marketing: Project = {
  project_id: 'proj_mkt',
  project_name: 'Marketing',
  project_access: 'members',
  can_manage: true,
  personal_for_user_id: null,
  is_workspace_default: false,
} as Project;

function chat(session_id: string, session_title: string): Session {
  return {
    session_id,
    project_id: 'proj_mkt',
    session_title,
    session_status: 'active',
    session_source: 'dashboard',
    created_time: '2026-09-01T00:00:00Z',
    last_updated_time: '2026-09-01T00:00:00Z',
    last_message_time: '2026-09-01T00:00:00Z',
  } as Session;
}

const nina: WorkspaceMember = {
  user_id: 'usr_nina',
  email: 'nina@example.com',
  first_name: 'Nina',
  last_name: 'Rossi',
  member_role: 'member',
};

function render_home(sessions: Session[], people: WorkspaceMember[] = [nina]) {
  const client = new QueryClient();
  client.setQueryData(query_keys.project(marketing.project_id), marketing);
  client.setQueryData(query_keys.sessions(marketing.project_id), sessions);
  client.setQueryData(query_keys.project_members(marketing.project_id), { members: [] });
  client.setQueryData(query_keys.workspace_members(), people);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ProjectHomePage, { project_id: marketing.project_id }),
    ),
  );
}

describe('the project home page', () => {
  it('names the project and lists the chats inside it', () => {
    const html = render_home([
      chat('ses_promo', 'Fall promo subject lines'),
      chat('ses_pricing', 'Pricing page'),
    ]);

    expect(html).toContain('Marketing');
    expect(html).toContain('Fall promo subject lines');
    expect(html).toContain('href="/chats/ses_promo"');
    expect(html).toContain('Pricing page');
  });

  it('offers to start a chat in this project', () => {
    expect(render_home([])).toContain('New chat');
  });

  it('says so rather than showing an empty list', () => {
    expect(render_home([])).toContain('No chats yet.');
  });

  it('offers the two controls: add people, and edit', () => {
    const html = render_home([chat('ses_promo', 'Fall promo subject lines')]);

    expect(html).toContain('Add people');
    expect(html).toContain('Nina Rossi');
    expect(html).toContain('Edit');
    expect(html).toContain('href="/projects/proj_mkt/edit"');
  });

  it('keeps the settings screen off the home page', () => {
    const html = render_home([chat('ses_promo', 'Fall promo subject lines')]);

    expect(html).not.toContain('Tool permissions');
    expect(html).not.toContain('Access');
    expect(html).not.toContain('Connections');
    expect(html).not.toContain('Can manage it');
  });
});

describe('who is left to add', () => {
  const already_in: ProjectMember = {
    grantee_type: 'user',
    grantee_id: 'usr_nina',
    grant_level: 'use',
  } as ProjectMember;

  it('leaves out the people already in the project', () => {
    expect(people_not_in_project([already_in], [nina])).toEqual([]);
  });

  it('keeps the people who are not', () => {
    expect(people_not_in_project([], [nina])).toEqual([nina]);
  });

  it('reads user rows only', () => {
    const agent = { grantee_type: 'agent', grantee_id: 'usr_nina' } as ProjectMember;
    expect(people_not_in_project([agent], [nina])).toEqual([nina]);
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
