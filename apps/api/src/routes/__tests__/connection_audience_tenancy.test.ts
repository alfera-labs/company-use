import {
  read_data,
  request_json,
  share_with_projects,
} from '@api/routes/__tests__/connection_audience_org';
import {
  build_two_tenants,
  type Tenants,
} from '@api/routes/__tests__/connection_audience_two_tenants';
import { check_resource_use } from '@coworker/core/access/check_resource_use';
import { beforeAll, describe, expect, it } from 'vitest';

let t: Tenants;

beforeAll(async () => {
  t = await build_two_tenants();
}, 120_000);

describe('two tenants that share app names and nothing else', () => {
  it('shows each workspace only its own connections', async () => {
    const bigco_list = await read_data(t.app, t.bigco.admin.headers, 'GET', '/v1/connections');
    const maker_list = await read_data(t.app, t.maker.admin.headers, 'GET', '/v1/connections');
    const ids = (list: Array<{ connection_id: string }>) => list.map((row) => row.connection_id);
    expect(ids(bigco_list)).toEqual([t.bigco.github]);
    expect(ids(maker_list)).toEqual([t.maker.github]);
  });

  it('never lets one tenant’s rooms or people satisfy the other tenant’s gate', async () => {
    const cross = await check_resource_use(t.db, {
      workspace_id: t.maker.workspace_id,
      resource_type: 'connection',
      resource_id: t.maker.github,
      participants: {
        project: [t.bigco.engineering],
        agent: [],
        user: [t.bigco.admin.user_id],
      },
    });
    expect(cross).toMatchObject({ allowed: false, blocked_grantee_type: 'project' });

    const foreign_room = await request_json(
      t.app,
      t.maker.admin.headers,
      'GET',
      `/v1/projects/${t.bigco.engineering}`,
    );
    expect(foreign_room.status).toBe(404);
  });

  it('answers the audience of a foreign or invented id as “not found”', async () => {
    const foreign = await request_json(
      t.app,
      t.maker.admin.headers,
      'GET',
      `/v1/access/connection/${t.bigco.github}`,
    );
    expect(foreign.status).toBe(404);

    const invented = await request_json(
      t.app,
      t.maker.admin.headers,
      'GET',
      '/v1/access/connection/conn_never_existed',
    );
    expect(invented.status).toBe(404);
  });

  it('refuses to write a foreign connection id into the writer’s own workspace', async () => {
    const written = await request_json(
      t.app,
      t.maker.admin.headers,
      'PUT',
      `/v1/access/connection/${t.bigco.github}`,
      share_with_projects([t.maker.sales]),
    );
    expect(written.status).toBe(404);

    const ticked = await request_json(
      t.app,
      t.maker.admin.headers,
      'POST',
      `/v1/access/connection/${t.bigco.github}/grantees`,
      { project: t.maker.sales, can: 'use' },
    );
    expect(ticked.status).toBe(404);

    const bigco_view = await read_data(
      t.app,
      t.bigco.admin.headers,
      'GET',
      `/v1/access/connection/${t.bigco.github}`,
    );
    expect(bigco_view.shared_with).toEqual([{ project: t.bigco.engineering, can: 'use' }]);
    expect(
      await check_resource_use(t.db, {
        workspace_id: t.bigco.workspace_id,
        resource_type: 'connection',
        resource_id: t.bigco.github,
        participants: { project: [t.maker.sales], agent: [], user: [] },
      }),
    ).toMatchObject({ allowed: false });
  });

  it('refuses a foreign project id rather than writing a restriction nobody can satisfy', async () => {
    const written = await request_json(
      t.app,
      t.maker.admin.headers,
      'PUT',
      `/v1/access/connection/${t.maker.github}`,
      share_with_projects([t.bigco.engineering]),
    );
    expect(written.status).toBe(422);
    expect((await written.json()).error.message).toContain(t.bigco.engineering);

    const still_scoped = await check_resource_use(t.db, {
      workspace_id: t.maker.workspace_id,
      resource_type: 'connection',
      resource_id: t.maker.github,
      participants: { project: [t.maker.production], agent: [], user: [t.maker.floor.user_id] },
    });
    expect(still_scoped.allowed).toBe(true);
  });

  it('refuses a person or coworker this workspace does not have', async () => {
    const stranger = await request_json(
      t.app,
      t.maker.admin.headers,
      'PUT',
      `/v1/access/connection/${t.maker.github}`,
      {
        shared_with_everyone_in_the_workspace: false,
        shared_with: [{ person: t.bigco.admin.user_id, can: 'use' }],
      },
    );
    expect(stranger.status).toBe(422);
    expect((await stranger.json()).error.message).toContain('person');

    const invented_coworker = await request_json(
      t.app,
      t.maker.admin.headers,
      'POST',
      `/v1/access/connection/${t.maker.github}/grantees`,
      { coworker: 'agt_never_existed', can: 'use' },
    );
    expect(invented_coworker.status).toBe(422);
    expect((await invented_coworker.json()).error.message).toContain('coworker');
  });
});
