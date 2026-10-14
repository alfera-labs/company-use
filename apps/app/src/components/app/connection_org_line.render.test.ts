import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionOrgLine, SiblingAudienceNote } from '@/components/app/connection_org_line';
import type { ResourceSharing, SharingGrantee, WorkspaceMember } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection } from '@/lib/api/types';

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

const members: WorkspaceMember[] = [
  {
    user_id: 'usr_robin',
    email: 'robin@northwind.com',
    first_name: 'Robin',
    last_name: 'Tate',
    member_role: 'owner',
  },
  {
    user_id: 'usr_nina',
    email: 'nina@northwind.com',
    first_name: 'Nina',
    last_name: 'Boro',
    member_role: 'member',
  },
];

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    connection_id: 'conn_gmail_1',
    app_id: 'app_gmail',
    connection_name: null,
    connection_status: 'active',
    connected_by: 'usr_nina',
    app: { app_display_name: 'Gmail' },
    ...overrides,
  } as Connection;
}

function sharing(...shared_with: SharingGrantee[]): ResourceSharing {
  return {
    resource_type: 'connection',
    shared_with_everyone_in_the_workspace: shared_with.length === 0,
    shared_with,
  };
}

function client_with(sharings: Record<string, ResourceSharing>) {
  const client = new QueryClient();
  client.setQueryData(query_keys.projects(''), []);
  client.setQueryData(query_keys.workspace_members(), members);
  client.setQueryData(query_keys.workspace(), { workspace_name: 'Northwind' });
  for (const [connection_id, value] of Object.entries(sharings)) {
    client.setQueryData(query_keys.sharing('connection', connection_id), value);
  }
  return client;
}

function render_line(row: Connection, sharings: Record<string, ResourceSharing>) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: client_with(sharings) },
      createElement(ConnectionOrgLine, { connection: row }),
    ),
  );
}

function render_note(
  row: Connection,
  rows: Connection[],
  sharings: Record<string, ResourceSharing>,
) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: client_with(sharings) },
      createElement(SiblingAudienceNote, { connection: row, connections: rows }),
    ),
  );
}

describe('a connection row on the integrations page', () => {
  it('names who connected the account, so the workspace knows whose credential it is', () => {
    const html = render_line(connection(), { conn_gmail_1: sharing() });

    expect(html).toContain('Connected by Nina Boro');
  });

  it('says nothing about an owner who is not in the workspace member list', () => {
    const html = render_line(connection({ connected_by: 'usr_gone' }), {
      conn_gmail_1: sharing(),
    });

    expect(html).not.toContain('Connected by');
  });

  it('carries the same audience picker the project page uses', () => {
    const html = render_line(connection(), { conn_gmail_1: sharing() });

    expect(html).toContain('Who can use this connection');
    expect(html).toContain('Everyone at Northwind');
  });

  it('names the projects plainly, because no room is being read from here', () => {
    const html = render_line(connection(), { conn_gmail_1: sharing() });

    expect(html).not.toContain('(this project)');
  });
});

describe('two connections to the same app', () => {
  const first = connection();
  const second = connection({ connection_id: 'conn_gmail_2' });

  it('says so under the second row when their audiences disagree', () => {
    const html = render_note(second, [first, second], {
      conn_gmail_1: sharing(),
      conn_gmail_2: sharing({ project: 'proj_sales', can: 'use' }),
    });

    expect(html).toContain('Another Gmail connection has a different audience.');
  });

  it('stays quiet when both are reachable by the same people', () => {
    const html = render_note(second, [first, second], {
      conn_gmail_1: sharing({ project: 'proj_sales', can: 'use' }),
      conn_gmail_2: sharing({ project: 'proj_sales', can: 'use' }),
    });

    expect(html).toBe('');
  });

  it('says nothing on the first row, which introduces no disagreement yet', () => {
    const html = render_note(first, [first, second], {
      conn_gmail_1: sharing(),
      conn_gmail_2: sharing({ project: 'proj_sales', can: 'use' }),
    });

    expect(html).toBe('');
  });

  it('ignores a different app with a different audience', () => {
    const slack = connection({
      connection_id: 'conn_slack_1',
      app_id: 'app_slack',
      app: { app_display_name: 'Slack' },
    } as Partial<Connection>);
    const html = render_note(slack, [first, slack], {
      conn_gmail_1: sharing(),
      conn_slack_1: sharing({ project: 'proj_sales', can: 'use' }),
    });

    expect(html).toBe('');
  });

  it('waits rather than guessing while a sibling audience is still loading', () => {
    const html = render_note(second, [first, second], {
      conn_gmail_2: sharing({ project: 'proj_sales', can: 'use' }),
    });

    expect(html).toBe('');
  });
});
