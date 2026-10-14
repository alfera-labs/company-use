import {
  create_catalog_app,
  create_connection,
  request_json,
  share_with_projects,
} from '@api/routes/__tests__/connection_audience_org';
import { build_smallco, type Smallco } from '@api/routes/__tests__/connection_audience_smallco';
import { beforeAll, describe, expect, it } from 'vitest';

let org: Smallco;
const adas_figma = 'conn_adas_figma';
const cleo_gmail = 'conn_cleo_gmail';

beforeAll(async () => {
  org = await build_smallco();
  for (const [connection_id, app_name, connected_by] of [
    [adas_figma, 'figma', org.ada.user_id],
    [cleo_gmail, 'gmail', org.cleo.user_id],
  ] as const) {
    await create_connection(org.db, {
      workspace_id: org.workspace_id,
      app_id: await create_catalog_app(org.db, app_name),
      connection_id,
      connection_name: app_name,
      connected_by,
    });
  }
}, 120_000);

describe('changing who administers the workspace', () => {
  const member_path = (user_id: string) => `/v1/workspace/members/${user_id}`;

  it('refuses a plain member the right to change seats', async () => {
    const refused = await request_json(
      org.app,
      org.cleo.headers,
      'PATCH',
      member_path(org.bo.user_id),
      {
        role: 'member',
      },
    );
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe('team_access_denied');
  });

  it('lets an admin promote a member, who may then scope any connection', async () => {
    const promoted = await request_json(
      org.app,
      org.ada.headers,
      'PATCH',
      member_path(org.cleo.user_id),
      { role: 'admin' },
    );
    expect(promoted.status).toBe(200);
    expect((await promoted.json()).data).toEqual({
      user_id: org.cleo.user_id,
      member_role: 'admin',
    });

    const now_allowed = await request_json(
      org.app,
      org.cleo.headers,
      'PUT',
      org.sharing_path(adas_figma),
      share_with_projects([org.hr_room]),
    );
    expect(now_allowed.status).toBe(200);
  });

  it('refuses to demote the last administrator', async () => {
    for (const person of [org.ada, org.bo]) {
      const demoted = await request_json(
        org.app,
        org.cleo.headers,
        'PATCH',
        member_path(person.user_id),
        { role: 'member' },
      );
      expect(demoted.status).toBe(200);
    }

    const last_one = await request_json(
      org.app,
      org.cleo.headers,
      'PATCH',
      member_path(org.cleo.user_id),
      { role: 'member' },
    );
    expect(last_one.status).toBe(409);
    expect((await last_one.json()).error.message).toContain('at least one admin');
  });

  it('takes the audience away with the seat', async () => {
    const refused = await request_json(
      org.app,
      org.ada.headers,
      'PUT',
      org.sharing_path(cleo_gmail),
      share_with_projects([org.dev_room]),
    );
    expect(refused.status).toBe(403);
  });
});
