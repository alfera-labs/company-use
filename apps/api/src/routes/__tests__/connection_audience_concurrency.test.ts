import {
  add_to_room,
  create_catalog_app,
  create_connection,
  project_ids_in,
  read_data,
  request_json,
  share_with_projects,
} from '@api/routes/__tests__/connection_audience_org';
import { build_smallco, type Smallco } from '@api/routes/__tests__/connection_audience_smallco';
import { check_resource_use } from '@coworker/core/access/check_resource_use';
import { beforeAll, describe, expect, it } from 'vitest';

let org: Smallco;

beforeAll(async () => {
  org = await build_smallco();
}, 120_000);

describe('two admins pulling on the same connection', () => {
  const shared_notion = 'conn_notion_shared';

  beforeAll(async () => {
    const app_id = await create_catalog_app(org.db, 'notion');
    await create_connection(org.db, {
      workspace_id: org.workspace_id,
      app_id,
      connection_id: shared_notion,
      connection_name: 'Notion',
      connected_by: org.ada.user_id,
    });
    await read_data(
      org.app,
      org.ada.headers,
      'PUT',
      org.sharing_path(shared_notion),
      share_with_projects([org.dev_room]),
    );
  });

  it('keeps both admins’ ticks when they start from the same read', async () => {
    const seen_by_both = await org.read_sharing(org.ada, shared_notion);
    expect(project_ids_in(seen_by_both)).toEqual([org.dev_room]);

    const tick = (headers: Record<string, string>, project_id: string) =>
      request_json(org.app, headers, 'POST', `${org.sharing_path(shared_notion)}/grantees`, {
        project: project_id,
        can: 'use',
      });

    expect((await tick(org.ada.headers, org.ads_room)).status).toBe(200);
    expect((await tick(org.bo.headers, org.hr_room)).status).toBe(200);

    const after = await org.read_sharing(org.ada, shared_notion);
    expect(project_ids_in(after).sort()).toEqual([org.dev_room, org.ads_room, org.hr_room].sort());

    const ads_verdict = await check_resource_use(org.db, {
      workspace_id: org.workspace_id,
      resource_type: 'connection',
      resource_id: shared_notion,
      participants: { project: [org.ads_room], agent: [], user: [] },
    });
    expect(ads_verdict.allowed).toBe(true);
  });

  it('unticks one room without disturbing the others', async () => {
    const before = await org.read_sharing(org.ada, shared_notion);
    expect(project_ids_in(before)).toHaveLength(3);

    const untick = await request_json(
      org.app,
      org.bo.headers,
      'DELETE',
      `${org.sharing_path(shared_notion)}/grantees/project/${org.ads_room}`,
    );
    expect(untick.status).toBe(200);
    expect(project_ids_in(await untick.json().then((body) => body.data)).sort()).toEqual(
      [org.dev_room, org.hr_room].sort(),
    );

    const again = await request_json(
      org.app,
      org.ada.headers,
      'DELETE',
      `${org.sharing_path(shared_notion)}/grantees/project/${org.ads_room}`,
    );
    expect(again.status).toBe(200);
  });

  it('turns an unticked last room into “everyone”, which the picker now refuses to do silently', async () => {
    const emptied = await request_json(
      org.app,
      org.ada.headers,
      'PUT',
      org.sharing_path(shared_notion),
      { shared_with_everyone_in_the_workspace: false, shared_with: [] },
    );
    expect(emptied.status).toBe(422);

    const body = { shared_with_everyone_in_the_workspace: true, shared_with: [] };
    expect(
      (await request_json(org.app, org.ada.headers, 'PUT', org.sharing_path(shared_notion), body))
        .status,
    ).toBe(200);
    const opened = await check_resource_use(org.db, {
      workspace_id: org.workspace_id,
      resource_type: 'connection',
      resource_id: shared_notion,
      participants: { project: [org.ads_room], agent: [], user: [] },
    });
    expect(opened).toEqual({ allowed: true, grant_level: 'use' });
  });
});

describe('the last entry in an audience', () => {
  const sole_room_figma = 'conn_figma_one_room';
  const two_room_figma = 'conn_figma_two_rooms';

  beforeAll(async () => {
    const app_id = await create_catalog_app(org.db, 'figma');
    for (const connection_id of [sole_room_figma, two_room_figma]) {
      await create_connection(org.db, {
        workspace_id: org.workspace_id,
        app_id,
        connection_id,
        connection_name: 'Figma',
        connected_by: org.ada.user_id,
      });
    }
    await read_data(
      org.app,
      org.ada.headers,
      'PUT',
      org.sharing_path(sole_room_figma),
      share_with_projects([org.dev_room]),
    );
    await read_data(
      org.app,
      org.ada.headers,
      'PUT',
      org.sharing_path(two_room_figma),
      share_with_projects([org.dev_room, org.ads_room]),
    );
  });

  it('refuses to untick the only room, and leaves the row standing', async () => {
    const refused = await request_json(
      org.app,
      org.ada.headers,
      'DELETE',
      `${org.sharing_path(sole_room_figma)}/grantees/project/${org.dev_room}`,
    );
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toBe(
      'Removing the last entry would open this to everyone. ' +
        'Set the audience to Everyone explicitly instead.',
    );

    expect(project_ids_in(await org.read_sharing(org.ada, sole_room_figma))).toEqual([
      org.dev_room,
    ]);
    const outside = await check_resource_use(org.db, {
      workspace_id: org.workspace_id,
      resource_type: 'connection',
      resource_id: sole_room_figma,
      participants: { project: [org.hr_room], agent: [], user: [org.cleo.user_id] },
    });
    expect(outside.allowed).toBe(false);
  });

  it('lets the first untick land and refuses the second', async () => {
    const untick = (person: { headers: Record<string, string> }, project_id: string) =>
      request_json(
        org.app,
        person.headers,
        'DELETE',
        `${org.sharing_path(two_room_figma)}/grantees/project/${project_id}`,
      );

    expect((await untick(org.ada, org.ads_room)).status).toBe(200);
    expect((await untick(org.bo, org.dev_room)).status).toBe(409);
    expect(project_ids_in(await org.read_sharing(org.ada, two_room_figma))).toEqual([org.dev_room]);
  });

  it('still accepts an audience of Everyone when that is what was asked for', async () => {
    const opened = await request_json(
      org.app,
      org.ada.headers,
      'PUT',
      org.sharing_path(two_room_figma),
      { shared_with_everyone_in_the_workspace: true, shared_with: [] },
    );
    expect(opened.status).toBe(200);
    expect((await org.read_sharing(org.ada, two_room_figma)).shared_with).toEqual([]);
  });

  it('refuses the same removal through the connection people list', async () => {
    const private_figma = 'conn_figma_private';
    const app_id = await create_catalog_app(org.db, 'framer');
    await create_connection(org.db, {
      workspace_id: org.workspace_id,
      app_id,
      connection_id: private_figma,
      connection_name: 'Framer',
      connected_by: org.ada.user_id,
    });
    await read_data(org.app, org.ada.headers, 'PUT', org.sharing_path(private_figma), {
      shared_with_everyone_in_the_workspace: false,
      shared_with: [{ person: org.ada.user_id, can: 'manage' }],
    });

    const refused = await request_json(
      org.app,
      org.ada.headers,
      'DELETE',
      `/v1/connections/${private_figma}/access/members/${org.ada.user_id}`,
    );
    expect(refused.status).toBe(409);
    expect((await org.read_sharing(org.ada, private_figma)).shared_with).toEqual([
      { person: org.ada.user_id, can: 'manage' },
    ]);
  });
});

describe('a full replace computed from a stale read', () => {
  const linear = 'conn_linear_replaces';

  beforeAll(async () => {
    const app_id = await create_catalog_app(org.db, 'airtable');
    await create_connection(org.db, {
      workspace_id: org.workspace_id,
      app_id,
      connection_id: linear,
      connection_name: 'Airtable',
      connected_by: org.ada.user_id,
    });
    await read_data(
      org.app,
      org.ada.headers,
      'PUT',
      org.sharing_path(linear),
      share_with_projects([org.dev_room]),
    );
  });

  it('refuses the save and names the reload, leaving the newer audience standing', async () => {
    const seen_by_ada = await org.read_sharing(org.ada, linear);
    expect(project_ids_in(seen_by_ada)).toEqual([org.dev_room]);
    await read_data(org.app, org.bo.headers, 'POST', `${org.sharing_path(linear)}/grantees`, {
      project: org.ads_room,
      can: 'use',
    });

    const stale = await request_json(org.app, org.ada.headers, 'PUT', org.sharing_path(linear), {
      shared_with_everyone_in_the_workspace: false,
      shared_with: [{ person: org.ada.user_id, can: 'use' }],
      replaces: seen_by_ada.shared_with,
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.message).toBe(
      'The audience changed while you were editing. Reload to see it.',
    );
    expect(project_ids_in(await org.read_sharing(org.ada, linear)).sort()).toEqual(
      [org.dev_room, org.ads_room].sort(),
    );
  });

  it('accepts the same save once the editor has read the current audience', async () => {
    const fresh = await org.read_sharing(org.ada, linear);
    const accepted = await request_json(org.app, org.ada.headers, 'PUT', org.sharing_path(linear), {
      shared_with_everyone_in_the_workspace: false,
      shared_with: [{ person: org.ada.user_id, can: 'use' }],
      replaces: fresh.shared_with,
    });
    expect(accepted.status).toBe(200);
    expect((await org.read_sharing(org.ada, linear)).shared_with).toEqual([
      { person: org.ada.user_id, can: 'use' },
    ]);
  });

  it('leaves a save that states the audience outright alone', async () => {
    const stated = await request_json(org.app, org.ada.headers, 'PUT', org.sharing_path(linear), {
      shared_with_everyone_in_the_workspace: true,
      shared_with: [],
    });
    expect(stated.status).toBe(200);
  });
});

describe('a mixed audience of rooms and people', () => {
  const mixed = 'conn_mixed';

  beforeAll(async () => {
    const app_id = await create_catalog_app(org.db, 'linear');
    await create_connection(org.db, {
      workspace_id: org.workspace_id,
      app_id,
      connection_id: mixed,
      connection_name: 'Linear',
      connected_by: org.ada.user_id,
    });
    await add_to_room(org.app, org.ada, org.dev_room, org.bo);
    await read_data(org.app, org.ada.headers, 'PUT', org.sharing_path(mixed), {
      shared_with_everyone_in_the_workspace: false,
      shared_with: [
        { project: org.dev_room, can: 'use' },
        { person: org.ada.user_id, can: 'use' },
      ],
    });
  });

  it('denies an engineer inside the engineering room because the person row must pass too', async () => {
    const ask = (user: string[]) =>
      check_resource_use(org.db, {
        workspace_id: org.workspace_id,
        resource_type: 'connection',
        resource_id: mixed,
        participants: { project: [org.dev_room], agent: [], user },
      });

    expect((await ask([org.ada.user_id])).allowed).toBe(true);
    expect(await ask([org.bo.user_id])).toMatchObject({
      allowed: false,
      denial_reason: 'not_on_the_list',
      blocked_grantee_type: 'user',
    });
    expect((await ask([org.ada.user_id, org.bo.user_id])).allowed).toBe(false);
  });
});
