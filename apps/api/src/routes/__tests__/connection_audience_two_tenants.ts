import {
  type ApiApp,
  add_to_room,
  create_api,
  create_catalog_app,
  create_connection,
  create_room,
  type Person,
  read_data,
  share_with_projects,
  sign_in,
} from '@api/routes/__tests__/connection_audience_org';
import type { Database } from '@coworker/core/db/connection';

export type Tenants = {
  db: Database;
  app: ApiApp;
  github_app_id: string;
  bigco: { admin: Person; workspace_id: string; engineering: string; github: string };
  maker: {
    admin: Person;
    floor: Person;
    workspace_id: string;
    production: string;
    sales: string;
    github: string;
  };
};

export async function build_two_tenants(): Promise<Tenants> {
  const { db, app } = await create_api();
  const github_app_id = await create_catalog_app(db, 'github');

  const bigco_admin = await sign_in(app, {
    name: 'ada',
    email: 'ada@bigco.test',
    organization: 'org_bigco',
  });
  const bigco_id = (await read_data(app, bigco_admin.headers, 'GET', '/v1/workspace')).workspace_id;
  const engineering = await create_room(app, bigco_admin, 'engineering');
  const bigco_github = await create_connection(db, {
    workspace_id: bigco_id,
    app_id: github_app_id,
    connection_id: 'conn_bigco_github',
    connection_name: 'GitHub',
    connected_by: bigco_admin.user_id,
  });
  await read_data(
    app,
    bigco_admin.headers,
    'PUT',
    `/v1/access/connection/${bigco_github}`,
    share_with_projects([engineering]),
  );

  const maker_admin = await sign_in(app, {
    name: 'mira',
    email: 'mira@maker.test',
    organization: 'org_maker',
  });
  const maker_floor = await sign_in(app, {
    name: 'finn',
    email: 'finn@maker.test',
    organization: 'org_maker',
  });
  const maker_id = (await read_data(app, maker_admin.headers, 'GET', '/v1/workspace')).workspace_id;
  const production = await create_room(app, maker_admin, 'production');
  const sales = await create_room(app, maker_admin, 'sales');
  await create_room(app, maker_admin, 'marketing');
  await add_to_room(app, maker_admin, production, maker_floor);
  const maker_github = await create_connection(db, {
    workspace_id: maker_id,
    app_id: github_app_id,
    connection_id: 'conn_maker_github',
    connection_name: 'GitHub',
    connected_by: maker_admin.user_id,
  });
  await read_data(
    app,
    maker_admin.headers,
    'PUT',
    `/v1/access/connection/${maker_github}`,
    share_with_projects([production]),
  );

  return {
    db,
    app,
    github_app_id,
    bigco: {
      admin: bigco_admin,
      workspace_id: bigco_id,
      engineering,
      github: bigco_github,
    },
    maker: {
      admin: maker_admin,
      floor: maker_floor,
      workspace_id: maker_id,
      production,
      sales,
      github: maker_github,
    },
  };
}
