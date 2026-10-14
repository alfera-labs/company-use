import {
  create_catalog_app,
  create_catalog_node,
  create_connection,
  project_ids_in,
  read_data,
  request_json,
  share_with_everyone,
  share_with_projects,
} from '@api/routes/__tests__/connection_audience_org';
import {
  build_two_tenants,
  type Tenants,
} from '@api/routes/__tests__/connection_audience_two_tenants';
import { check_resource_use } from '@coworker/core/access/check_resource_use';
import { resolve_catalog_tool } from '@coworker/core/db/queries/catalog';
import { build_restricted_access_config } from '@coworker/core/db/queries/connection_access';
import { beforeAll, describe, expect, it } from 'vitest';

let t: Tenants;

beforeAll(async () => {
  t = await build_two_tenants();
}, 120_000);

describe('the legacy allow-list and the audience rows guard the same connection', () => {
  const private_gmail = 'conn_mira_gmail';
  let node_key: string;

  beforeAll(async () => {
    const gmail_app_id = await create_catalog_app(t.db, 'gmail');
    node_key = await create_catalog_node(t.db, {
      app_id: gmail_app_id,
      app_name: 'gmail',
      node_name: 'send_email',
    });
    await create_connection(t.db, {
      workspace_id: t.maker.workspace_id,
      app_id: gmail_app_id,
      connection_id: private_gmail,
      connection_name: "Mira's Gmail",
      connected_by: t.maker.admin.user_id,
      connection_config: build_restricted_access_config(t.maker.admin.user_id),
    });
    await read_data(
      t.app,
      t.maker.admin.headers,
      'PUT',
      `/v1/access/connection/${private_gmail}`,
      share_with_everyone(),
    );
  });

  it('lets the audience answer alone, because the JSONB allow-list no longer gates anything', async () => {
    const audience = await read_data(
      t.app,
      t.maker.admin.headers,
      'GET',
      `/v1/access/connection/${private_gmail}`,
    );
    expect(audience.shared_with).toEqual([]);
    expect(audience.shared_with_everyone_in_the_workspace).toBe(true);

    const in_the_room = {
      project: [t.maker.production],
      agent: [],
      user: [t.maker.floor.user_id],
    };
    const gate = await check_resource_use(t.db, {
      workspace_id: t.maker.workspace_id,
      resource_type: 'connection',
      resource_id: private_gmail,
      participants: in_the_room,
    });
    expect(gate.allowed).toBe(true);

    const resolve_for = (person: { user_id: string }) =>
      resolve_catalog_tool(t.db, {
        workspace_id: t.maker.workspace_id,
        node_key,
        participants: { ...in_the_room, user: [person.user_id] },
      });

    expect((await resolve_for(t.maker.admin)).connection?.connection_id).toBe(private_gmail);
    expect(await resolve_for(t.maker.floor)).toMatchObject({
      connection: { connection_id: private_gmail },
      access_denied: false,
    });
  });

  it('refuses the colleague once the audience names one person', async () => {
    await read_data(t.app, t.maker.admin.headers, 'PUT', `/v1/access/connection/${private_gmail}`, {
      shared_with_everyone_in_the_workspace: false,
      shared_with: [{ person: t.maker.admin.user_id, can: 'manage' }],
    });

    const resolve_for = (person: { user_id: string }) =>
      resolve_catalog_tool(t.db, {
        workspace_id: t.maker.workspace_id,
        node_key,
        participants: { project: [], agent: [], user: [person.user_id] },
      });

    expect((await resolve_for(t.maker.admin)).connection?.connection_id).toBe(private_gmail);
    expect(await resolve_for(t.maker.floor)).toMatchObject({
      connection: null,
      access_denied: true,
    });
  });
});

describe('a room that is archived while a connection still points at it', () => {
  const build_tool = 'conn_maker_build';

  beforeAll(async () => {
    const app_id = await create_catalog_app(t.db, 'jenkins');
    await create_connection(t.db, {
      workspace_id: t.maker.workspace_id,
      app_id,
      connection_id: build_tool,
      connection_name: 'Jenkins',
      connected_by: t.maker.admin.user_id,
    });
    await read_data(
      t.app,
      t.maker.admin.headers,
      'PUT',
      `/v1/access/connection/${build_tool}`,
      share_with_projects([t.maker.sales]),
    );
    const archived = await request_json(
      t.app,
      t.maker.admin.headers,
      'PATCH',
      `/v1/projects/${t.maker.sales}`,
      { project_status: 'archived' },
    );
    expect(archived.status).toBe(200);
  });

  it('keeps the archived room’s grant, so the connection goes quiet instead of company-wide', async () => {
    const sharing = await read_data(
      t.app,
      t.maker.admin.headers,
      'GET',
      `/v1/access/connection/${build_tool}`,
    );
    expect(project_ids_in(sharing)).toEqual([t.maker.sales]);
    expect(sharing.shared_with_everyone_in_the_workspace).toBe(false);

    const in_live_room = await check_resource_use(t.db, {
      workspace_id: t.maker.workspace_id,
      resource_type: 'connection',
      resource_id: build_tool,
      participants: { project: [t.maker.production], agent: [], user: [t.maker.floor.user_id] },
    });
    expect(in_live_room).toMatchObject({
      allowed: false,
      denial_reason: 'not_on_the_list',
      blocked_grantee_type: 'project',
    });

    const in_no_room = await check_resource_use(t.db, {
      workspace_id: t.maker.workspace_id,
      resource_type: 'connection',
      resource_id: build_tool,
      participants: { project: [], agent: [], user: [t.maker.floor.user_id] },
    });
    expect(in_no_room.allowed).toBe(false);
  });

  it('leaves the connection unreachable until somebody re-scopes it', async () => {
    const rooms = await read_data(t.app, t.maker.admin.headers, 'GET', '/v1/projects');
    const visible_ids = rooms.map((room: { project_id: string }) => room.project_id);
    expect(visible_ids).not.toContain(t.maker.sales);

    await read_data(
      t.app,
      t.maker.admin.headers,
      'PUT',
      `/v1/access/connection/${build_tool}`,
      share_with_projects([t.maker.production]),
    );
    const in_live_room = await check_resource_use(t.db, {
      workspace_id: t.maker.workspace_id,
      resource_type: 'connection',
      resource_id: build_tool,
      participants: { project: [t.maker.production], agent: [], user: [t.maker.floor.user_id] },
    });
    expect(in_live_room.allowed).toBe(true);
  });
});
