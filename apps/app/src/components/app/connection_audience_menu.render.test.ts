import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionAudienceMenu } from '@/components/app/connection_audience_menu';
import type { ResourceSharing, SharingGrantee, WorkspaceMember } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Project } from '@/lib/api/types';

vi.mock('@/lib/auth_client', () => ({
  useAuth: () => ({ user: { email: 'robin@northwind.com' } }),
}));

vi.mock('@coworker/ui/components/dropdown-menu', () => {
  const box = (children: ReactNode) => createElement('div', null, children);
  return {
    DropdownMenu: ({ children }: { children?: ReactNode }) => box(children),
    DropdownMenuTrigger: ({ render }: { render?: ReactNode }) => box(render),
    DropdownMenuContent: ({ children }: { children?: ReactNode }) => box(children),
    DropdownMenuItem: ({ children }: { children?: ReactNode }) => box(children),
    DropdownMenuLabel: ({ children }: { children?: ReactNode }) => box(children),
    DropdownMenuSeparator: () => box(null),
    DropdownMenuSubmenu: ({ children }: { children?: ReactNode }) => box(children),
    DropdownMenuSubmenuTrigger: ({ children }: { children?: ReactNode }) => box(children),
  };
});

const robin: WorkspaceMember = {
  user_id: 'usr_robin',
  email: 'robin@northwind.com',
  first_name: 'Robin',
  last_name: 'Tate',
  member_role: 'owner',
};

function room(project_id: string, project_name: string): Project {
  return {
    project_id,
    project_name,
    workspace_id: 'ws_1',
    project_status: 'active',
    project_access: 'members',
    is_workspace_default: false,
    project_description: null,
    project_instructions: null,
    membership_version: 1,
    personal_for_user_id: null,
    created_time: '2026-09-01T00:00:00Z',
    last_updated_time: '2026-09-01T00:00:00Z',
  };
}

const rooms = [room('proj_new', 'New project'), room('proj_new_2', 'New project 2')];

function sharing(...shared_with: SharingGrantee[]): ResourceSharing {
  return {
    resource_type: 'connection',
    shared_with_everyone_in_the_workspace: shared_with.length === 0,
    shared_with,
  };
}

function render_menu(audience: ResourceSharing, current_project_id?: string) {
  const client = new QueryClient();
  client.setQueryData(query_keys.projects(''), rooms);
  client.setQueryData(query_keys.workspace_members(), [robin]);
  client.setQueryData(query_keys.workspace(), {
    workspace_name: 'Northwind',
    viewer_user_id: robin.user_id,
  });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConnectionAudienceMenu, {
        connection_id: 'conn_1',
        sharing: audience,
        ...(current_project_id ? { current_project_id } : {}),
      }),
    ),
  );
}

describe('the open audience menu answers what each choice means', () => {
  it('says which workspace "everyone" is, so it cannot be read as "everyone in this project"', () => {
    expect(render_menu(sharing())).toContain('Everyone at Northwind');
  });

  it('names the one person rather than saying "you", so it reads the same to a colleague', () => {
    expect(render_menu(sharing())).toContain('Only Robin Tate (you)');
  });

  it('captions the projects, so a second tick reads as another room and not as a replacement', () => {
    expect(render_menu(sharing())).toContain('Or only in these projects');
  });

  it('lists every shared room by name', () => {
    const html = render_menu(sharing());

    expect(html).toContain('New project');
    expect(html).toContain('New project 2');
  });

  it('marks the room the reader is standing in, and only on a project page', () => {
    expect(render_menu(sharing(), 'proj_new')).toContain('New project (this project)');
    expect(render_menu(sharing())).not.toContain('(this project)');
  });

  it('falls back to a plain "Everyone" before the workspace name has arrived', () => {
    const client = new QueryClient();
    client.setQueryData(query_keys.projects(''), rooms);
    client.setQueryData(query_keys.workspace_members(), [robin]);
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ConnectionAudienceMenu, { connection_id: 'conn_1', sharing: sharing() }),
      ),
    );

    expect(html).toContain('Everyone');
    expect(html).not.toContain('Everyone at');
  });

  it('offers the people of the workspace by name, under their own caption', () => {
    const html = render_menu(sharing());

    expect(html).toContain('Or only these people');
    expect(html).toContain('Robin Tate');
  });

  it('badges a connection shared with two named people with both names', () => {
    const client = new QueryClient();
    const ana: WorkspaceMember = {
      ...robin,
      user_id: 'usr_ana',
      first_name: 'Ana',
      last_name: 'Sample',
    };
    client.setQueryData(query_keys.projects(''), rooms);
    client.setQueryData(query_keys.workspace_members(), [robin, ana]);
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ConnectionAudienceMenu, {
          connection_id: 'conn_1',
          sharing: sharing(
            { person: robin.user_id, can: 'manage' },
            { person: ana.user_id, can: 'use' },
          ),
        }),
      ),
    );

    expect(html).toContain('Robin Tate and Ana Sample');
  });

  it('badges a room-scoped connection with the room, not with "everyone"', () => {
    expect(render_menu(sharing({ project: 'proj_new', can: 'use' }))).toContain('Only New project');
  });
});
