import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectConnectionsSection } from '@/components/app/project_connections_section';
import type { ResourceSharing, SharingGrantee, WorkspaceMember } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection, Workspace } from '@/lib/api/types';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, params, preload, href, children, ...anchor }: StubLinkProps) =>
    createElement('a', { ...anchor, href: href ?? stub_link_href(to ?? '', params) }, children),
}));

vi.mock('@/lib/auth_client', () => ({
  useAuth: () => ({ user: { email: 'nina@northwind.com' } }),
}));

const box = (children: ReactNode) => createElement('div', null, children);

vi.mock('@coworker/ui/components/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? box(children) : null,
  AlertDialogAction: ({ children }: { children?: ReactNode }) => box(children),
  AlertDialogCancel: ({ children }: { children?: ReactNode }) => box(children),
  AlertDialogContent: ({ children }: { children?: ReactNode }) => box(children),
  AlertDialogDescription: ({ children }: { children?: ReactNode }) => box(children),
  AlertDialogFooter: ({ children }: { children?: ReactNode }) => box(children),
  AlertDialogHeader: ({ children }: { children?: ReactNode }) => box(children),
  AlertDialogTitle: ({ children }: { children?: ReactNode }) => box(children),
}));

const this_room = 'proj_sales';
const owner = 'usr_nina';

const nina: WorkspaceMember = {
  user_id: owner,
  email: 'nina@northwind.com',
  first_name: 'Nina',
  last_name: 'Sample',
  member_role: 'member',
};
const bystander: WorkspaceMember = {
  user_id: 'usr_theo',
  email: 'theo@northwind.com',
  first_name: 'Theo',
  last_name: 'Baz',
  member_role: 'member',
};

function connection(connection_id: string, app_display_name: string): Connection {
  return {
    connection_id,
    app_id: `app_${app_display_name.toLowerCase()}`,
    connection_name: null,
    connection_status: 'active',
    connected_by: owner,
    app: { app_display_name },
  } as Connection;
}

function sharing(...shared_with: SharingGrantee[]): ResourceSharing {
  return {
    resource_type: 'connection',
    shared_with_everyone_in_the_workspace: shared_with.length === 0,
    shared_with,
  };
}

function render_section(
  rows: Array<{ row: Connection; sharing: ResourceSharing }>,
  members: WorkspaceMember[] = [nina],
  viewer_user_id = owner,
) {
  const client = new QueryClient();
  client.setQueryData(query_keys.workspace(), {
    workspace_name: 'Alfera',
    viewer_user_id,
  } as Workspace);
  client.setQueryData(query_keys.workspace_members(), members);
  client.setQueryData(
    query_keys.connections(),
    rows.map((entry) => entry.row),
  );
  for (const entry of rows) {
    client.setQueryData(query_keys.sharing('connection', entry.row.connection_id), entry.sharing);
  }
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ProjectConnectionsSection, { project_id: this_room, room_name: 'Sales' }),
    ),
  );
}

describe('the connections section on a project page', () => {
  it('says a connection is in this project, and offers to remove it', () => {
    const html = render_section([
      {
        row: connection('conn_1', 'Notion'),
        sharing: sharing({ project: this_room, can: 'use' }, { project: 'proj_ops', can: 'use' }),
      },
    ]);

    expect(html).toContain('Notion');
    expect(html).toContain('In this project');
    expect(html).toContain('Remove');
  });

  it('offers to remove it to the person who connected it after their email changed', () => {
    const html = render_section(
      [
        {
          row: connection('conn_1', 'Notion'),
          sharing: sharing({ project: this_room, can: 'use' }, { project: 'proj_ops', can: 'use' }),
        },
      ],
      [{ ...nina, email: 'nina.sample@northwind.com' }],
    );

    expect(html).toContain('Remove');
  });

  it('names the workspace for a connection everyone shares, with nothing to remove', () => {
    const html = render_section([{ row: connection('conn_1', 'Notion'), sharing: sharing() }]);

    expect(html).toContain('Everyone at Alfera');
    expect(html).not.toContain('Remove');
  });

  it('offers to add the connections that are not here yet', () => {
    const html = render_section([
      {
        row: connection('conn_1', 'Notion'),
        sharing: sharing({ project: 'proj_ops', can: 'use' }),
      },
    ]);

    expect(html).toContain('Add a connection');
    expect(html).toContain('No connections in this project yet.');
    expect(html).toContain('Add');
  });

  it('leaves the workspace audience picker on the integrations page', () => {
    const html = render_section([
      {
        row: connection('conn_1', 'Notion'),
        sharing: sharing({ project: this_room, can: 'use' }),
      },
    ]);

    expect(html).not.toContain('Or only in these projects');
    expect(html).not.toContain('Who can use this connection');
    expect(html).not.toContain('Open to everyone');
  });

  it('shows a colleague the state and nothing to click', () => {
    const html = render_section(
      [
        {
          row: connection('conn_1', 'Notion'),
          sharing: sharing({ project: this_room, can: 'use' }, { project: 'proj_ops', can: 'use' }),
        },
        {
          row: connection('conn_2', 'Linear'),
          sharing: sharing({ project: 'proj_ops', can: 'use' }),
        },
      ],
      [bystander],
      bystander.user_id,
    );

    expect(html).toContain('In this project');
    expect(html).toContain('Not in this project');
    expect(html).not.toContain('Remove');
    expect(html).not.toContain('>Add<');
  });

  it('points at the integrations page when nothing is connected', () => {
    const html = render_section([]);

    expect(html).toContain('Nothing connected yet.');
    expect(html).toContain('Connect an app');
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
