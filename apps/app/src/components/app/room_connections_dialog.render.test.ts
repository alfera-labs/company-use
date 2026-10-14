import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RoomConnectionsButton } from '@/components/app/room_connections_dialog';
import type { ResourceSharing, SharingGrantee, WorkspaceMember } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection, Project, ToolPolicy, Workspace } from '@/lib/api/types';

vi.mock('@/lib/auth_client', () => ({
  useAuth: () => ({ user: { email: 'nina@northwind.com' } }),
}));

const box = (children: ReactNode) => createElement('div', null, children);

vi.mock('@coworker/ui/components/alert-dialog', () => ({
  AlertDialog: ({ children }: { children?: ReactNode }) => box(children),
  AlertDialogContent: ({ children }: { children?: ReactNode }) => box(children),
  AlertDialogFooter: ({ children }: { children?: ReactNode }) => box(children),
  AlertDialogTitle: ({ children }: { children?: ReactNode }) => box(children),
}));

vi.mock('@coworker/ui/components/select', () => ({
  Select: ({ children }: { children?: ReactNode }) => box(children),
  SelectContent: ({ children }: { children?: ReactNode }) => box(children),
  SelectItem: ({ children }: { children?: ReactNode }) => box(children),
  SelectTrigger: ({ children }: { children?: ReactNode }) => box(children),
  SelectValue: () => box(null),
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

function render_dialog(
  rows: Array<{ row: Connection; sharing: ResourceSharing }>,
  members: WorkspaceMember[] = [nina],
  viewer_user_id = owner,
) {
  const client = new QueryClient();
  client.setQueryData(query_keys.workspace(), { viewer_user_id } as Workspace);
  client.setQueryData(query_keys.projects(''), [room(this_room, 'Sales')]);
  client.setQueryData(query_keys.workspace_members(), members);
  client.setQueryData(
    query_keys.connections(),
    rows.map((entry) => entry.row),
  );
  for (const entry of rows) {
    client.setQueryData(query_keys.sharing('connection', entry.row.connection_id), entry.sharing);
    client.setQueryData(
      query_keys.tool_policies('connection', entry.row.connection_id),
      [] as ToolPolicy[],
    );
  }
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(RoomConnectionsButton, { project_id: this_room }),
    ),
  );
}

describe('the connections dialog inside a chat', () => {
  it('opens from a labelled button in the header', () => {
    expect(render_dialog([])).toContain('Connections in this room');
  });

  it('names the room it is about', () => {
    expect(render_dialog([])).toContain('Connections in Sales');
  });

  it('says a shared connection already works here, and offers its access level', () => {
    const html = render_dialog([{ row: connection('conn_1', 'Notion'), sharing: sharing() }]);

    expect(html).toContain('Notion');
    expect(html).toContain('Available here');
    expect(html).toContain('Read only');
    expect(html).toContain('Writes need approval');
    expect(html).toContain('Read and write');
    expect(html).not.toContain('Add');
  });

  it('offers to add a connection that lives in other rooms', () => {
    const html = render_dialog([
      {
        row: connection('conn_1', 'Notion'),
        sharing: sharing({ project: 'proj_ops', can: 'use' }),
      },
    ]);

    expect(html).toContain('Add');
    expect(html).not.toContain('Available here');
  });

  it("says private, with no button, for another person's connection", () => {
    const html = render_dialog([
      {
        row: connection('conn_1', 'Notion'),
        sharing: sharing({ person: 'usr_robin', can: 'use' }),
      },
    ]);

    expect(html).toContain('Private');
    expect(html).not.toContain('Add');
  });

  it('admits once that an access level is not scoped to this room', () => {
    const html = render_dialog([{ row: connection('conn_1', 'Notion'), sharing: sharing() }]);

    expect(html).toContain('Access levels apply everywhere the connection is shared.');
  });

  it('shows a colleague what the room can reach and offers no control', () => {
    const html = render_dialog(
      [
        { row: connection('conn_1', 'Notion'), sharing: sharing() },
        {
          row: connection('conn_2', 'Linear'),
          sharing: sharing({ project: 'proj_ops', can: 'use' }),
        },
      ],
      [bystander],
      bystander.user_id,
    );

    expect(html).toContain('Available here');
    expect(html).toContain('Not in this project');
    expect(html).not.toContain('>Add<');
    expect(html).not.toContain('Read only');
  });

  it('says nothing about access levels when there is nothing connected', () => {
    const html = render_dialog([]);

    expect(html).toContain('Nothing connected yet.');
    expect(html).not.toContain('Access levels apply');
  });
});
