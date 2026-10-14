import {
  create_connection,
  read_data,
  request_json,
  share_with_everyone,
} from '@api/routes/__tests__/connection_audience_org';
import {
  build_two_tenants,
  type Tenants,
} from '@api/routes/__tests__/connection_audience_two_tenants';
import { connections } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

type AccessTable = {
  people: Array<{ user_id: string; name: string; email: string }>;
  projects: Array<{ project_id: string; project_name: string }>;
  connections: Array<{
    connection_id: string;
    connection_name: string;
    cells: Array<{ user_id: string; where: string; project_ids?: string[] }>;
  }>;
  memory_scopes: Array<{ scope_key: string; scope_kind: string; display_name: string }>;
};

let t: Tenants;
let table: AccessTable;

beforeAll(async () => {
  t = await build_two_tenants();
  await create_connection(t.db, {
    workspace_id: t.maker.workspace_id,
    app_id: t.github_app_id,
    connection_id: 'conn_mira_mailbox',
    connection_name: "Mira's mailbox",
    connected_by: t.maker.admin.user_id,
  });
  await read_data(t.app, t.maker.admin.headers, 'PUT', '/v1/access/connection/conn_mira_mailbox', {
    shared_with_everyone_in_the_workspace: false,
    shared_with: [{ person: t.maker.admin.user_id, can: 'use' }],
  });
  await create_connection(t.db, {
    workspace_id: t.maker.workspace_id,
    app_id: t.github_app_id,
    connection_id: 'conn_issue_tracker',
    connection_name: 'Issue tracker',
    connected_by: t.maker.floor.user_id,
  });
  await read_data(
    t.app,
    t.maker.admin.headers,
    'PUT',
    '/v1/access/connection/conn_issue_tracker',
    share_with_everyone(),
  );
  await create_connection(t.db, {
    workspace_id: t.maker.workspace_id,
    app_id: t.github_app_id,
    connection_id: 'conn_disconnected',
    connection_name: 'Disconnected last month',
    connected_by: t.maker.admin.user_id,
  });
  await t.db
    .update(connections)
    .set({ connection_status: 'revoked' })
    .where(eq(connections.connection_id, 'conn_disconnected'));
  table = await read_data(t.app, t.maker.admin.headers, 'GET', '/v1/access/table');
}, 120_000);

function cell(connection_id: string, user_id: string) {
  const row = table.connections.find((connection) => connection.connection_id === connection_id);
  return row?.cells.find((entry) => entry.user_id === user_id);
}

describe('the access table an admin reads before a security review', () => {
  it('lists the people and the live connections of this workspace only', () => {
    expect(table.people.map((person) => person.email).sort()).toEqual([
      'finn@maker.test',
      'mira@maker.test',
    ]);
    expect(table.connections.map((connection) => connection.connection_id).sort()).toEqual([
      'conn_issue_tracker',
      'conn_maker_github',
      'conn_mira_mailbox',
    ]);
  });

  it('says a connection shared with a project works in that project, for its members', () => {
    expect(cell(t.maker.github, t.maker.floor.user_id)).toEqual({
      user_id: t.maker.floor.user_id,
      where: 'projects',
      project_ids: [t.maker.production],
    });
    expect(table.projects).toContainEqual({
      project_id: t.maker.production,
      project_name: 'production',
    });
  });

  it('says a connection shared with one person works in that person own chats and nowhere for others', () => {
    expect(cell('conn_mira_mailbox', t.maker.admin.user_id)?.where).toBe('own_chats');
    expect(cell('conn_mira_mailbox', t.maker.floor.user_id)?.where).toBe('nowhere');
  });

  it('says a connection shared with everyone works everywhere', () => {
    expect(cell('conn_issue_tracker', t.maker.admin.user_id)?.where).toBe('everywhere');
    expect(cell('conn_issue_tracker', t.maker.floor.user_id)?.where).toBe('everywhere');
  });

  it('does not list the default workspace project as a memory scope', () => {
    const default_project_rows = table.memory_scopes.filter(
      (row) => row.scope_kind === 'project' && row.display_name === 'Workspace',
    );
    expect(default_project_rows).toEqual([]);
  });

  it('refuses a member who is not an admin', async () => {
    const response = await request_json(t.app, t.maker.floor.headers, 'GET', '/v1/access/table');

    expect(response.status).toBe(403);
  });
});
