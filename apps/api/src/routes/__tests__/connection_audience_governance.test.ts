import {
  create_catalog_app,
  create_connection,
  read_data,
  request_json,
  share_with_projects,
} from '@api/routes/__tests__/connection_audience_org';
import { build_smallco, type Smallco } from '@api/routes/__tests__/connection_audience_smallco';
import { check_resource_use } from '@coworker/core/access/check_resource_use';
import { beforeAll, describe, expect, it } from 'vitest';

let org: Smallco;
const cleo_gmail = 'conn_cleo_gmail';
const adas_figma = 'conn_adas_figma';

beforeAll(async () => {
  org = await build_smallco();
  const gmail_app_id = await create_catalog_app(org.db, 'gmail');
  await create_connection(org.db, {
    workspace_id: org.workspace_id,
    app_id: gmail_app_id,
    connection_id: cleo_gmail,
    connection_name: "Cleo's Gmail",
    connected_by: org.cleo.user_id,
  });
  const figma_app_id = await create_catalog_app(org.db, 'figma');
  await create_connection(org.db, {
    workspace_id: org.workspace_id,
    app_id: figma_app_id,
    connection_id: adas_figma,
    connection_name: "Ada's Figma",
    connected_by: org.ada.user_id,
  });
}, 120_000);

describe('who may scope a connection', () => {
  it('lets any member read the audience of a connection they cannot change', async () => {
    const sharing = await org.read_sharing(org.cleo, adas_figma);
    expect(sharing.shared_with_everyone_in_the_workspace).toBe(true);
  });

  it('refuses a member who neither connected it nor administers the workspace', async () => {
    const refused = await request_json(
      org.app,
      org.cleo.headers,
      'PUT',
      org.sharing_path(adas_figma),
      share_with_projects([org.dev_room]),
    );
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe('workspace_access_denied');
  });

  it('lets the member whose own credential it is scope it', async () => {
    const scoped = await request_json(
      org.app,
      org.cleo.headers,
      'PUT',
      org.sharing_path(cleo_gmail),
      share_with_projects([org.dev_room]),
    );
    expect(scoped.status).toBe(200);
    expect((await scoped.json()).data.shared_with).toEqual([{ project: org.dev_room, can: 'use' }]);
  });

  it('lets an admin scope a connection to a room its owner is not in', async () => {
    const scoped = await request_json(
      org.app,
      org.ada.headers,
      'PUT',
      org.sharing_path(cleo_gmail),
      share_with_projects([org.hr_room]),
    );
    expect(scoped.status).toBe(200);

    const in_cleos_room = await check_resource_use(org.db, {
      workspace_id: org.workspace_id,
      resource_type: 'connection',
      resource_id: cleo_gmail,
      participants: { project: [org.dev_room], agent: [], user: [org.cleo.user_id] },
    });
    expect(in_cleos_room.allowed).toBe(false);
  });

  it('keeps a connection visible to the person who made it and to an admin, whoever the audience names', async () => {
    const scoped = await request_json(
      org.app,
      org.ada.headers,
      'PUT',
      org.sharing_path(cleo_gmail),
      {
        shared_with_everyone_in_the_workspace: false,
        shared_with: [{ person: org.ada.user_id, can: 'manage' }],
      },
    );
    expect(scoped.status).toBe(200);

    const as_cleo = await read_data(org.app, org.cleo.headers, 'GET', '/v1/connections');
    expect(as_cleo.map((row: { connection_id: string }) => row.connection_id)).toContain(
      cleo_gmail,
    );

    const as_bo = await read_data(org.app, org.bo.headers, 'GET', '/v1/connections');
    const seen_by_bo = as_bo.find(
      (row: { connection_id: string }) => row.connection_id === cleo_gmail,
    );
    expect(seen_by_bo.permissions).toEqual({ can_use: false, can_manage: true, can_delete: true });
  });
});

describe('what each viewer is told the audience says', () => {
  const only_ada = 'conn_only_ada';

  beforeAll(async () => {
    const app_id = await create_catalog_app(org.db, 'dropbox');
    await create_connection(org.db, {
      workspace_id: org.workspace_id,
      app_id,
      connection_id: only_ada,
      connection_name: 'Dropbox',
      connected_by: org.ada.user_id,
    });
    await read_data(org.app, org.ada.headers, 'PUT', org.sharing_path(only_ada), {
      shared_with_everyone_in_the_workspace: false,
      shared_with: [{ person: org.ada.user_id, can: 'manage' }],
    });
  });

  it('hands every viewer byte-identical rows, and the label names the person for all of them', async () => {
    const as_ada = await org.read_sharing(org.ada, only_ada);
    const as_cleo = await org.read_sharing(org.cleo, only_ada);
    expect(as_cleo).toEqual(as_ada);
    expect(as_ada.shared_with).toEqual([{ person: org.ada.user_id, can: 'manage' }]);
  });

  it('discloses to every member exactly who holds every connection', async () => {
    const as_cleo = await org.read_sharing(org.cleo, only_ada);
    expect(as_cleo.shared_with).toContainEqual({ person: org.ada.user_id, can: 'manage' });
  });

  it('treats a connection nobody scoped as open to the whole workspace', async () => {
    const nobody_can_use = await check_resource_use(org.db, {
      workspace_id: org.workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_ghost',
      participants: { project: [org.dev_room], agent: [], user: [org.ada.user_id] },
    });
    expect(nobody_can_use).toEqual({ allowed: true, grant_level: 'use' });
  });
});
