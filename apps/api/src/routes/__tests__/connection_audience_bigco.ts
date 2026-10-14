import {
  type ApiApp,
  add_to_room,
  create_api,
  create_catalog_app,
  create_connection,
  create_room,
  type Person,
  read_data,
  share_with_everyone,
  share_with_projects,
  sign_in,
} from '@api/routes/__tests__/connection_audience_org';
import type { Participants } from '@coworker/core/access/may_use_resource';
import type { Database } from '@coworker/core/db/connection';

const organization = 'org_bigco';

export const departments = ['search', 'ads', 'cloud', 'hr', 'legal'] as const;
export type Department = (typeof departments)[number];

const staff: Record<string, Department[]> = {
  admin_ada: ['search', 'ads', 'cloud', 'hr', 'legal'],
  admin_bo: ['legal'],
  eng_1: ['search'],
  eng_2: ['search'],
  eng_3: ['search', 'cloud'],
  eng_4: ['cloud'],
  eng_5: ['cloud'],
  eng_6: ['cloud', 'ads'],
  ads_1: ['ads'],
  ads_2: ['ads'],
  ads_3: ['ads'],
  hr_1: ['hr'],
  hr_2: ['hr'],
  hr_3: ['hr'],
  legal_1: ['legal'],
  legal_2: ['legal'],
  legal_3: ['legal', 'hr'],
  floater_1: [],
  floater_2: [],
  floater_3: ['search', 'hr'],
};

export const connection_ids = {
  github: 'conn_github',
  gmail_hr: 'conn_gmail_hr',
  notion: 'conn_notion',
  stripe: 'conn_stripe',
  gmail_second: 'conn_gmail_second',
  personal_gmail: 'conn_gmail_personal',
} as const;

export type Bigco = {
  db: Database;
  app: ApiApp;
  workspace_id: string;
  admin: Person;
  people: Record<string, Person>;
  rooms: Record<Department, string>;
  admin_personal_room: string;
  room_of: (department: Department, occupants: readonly string[]) => Participants;
};

export async function build_bigco(): Promise<Bigco> {
  const { db, app } = await create_api();

  const people: Record<string, Person> = {};
  for (const name of Object.keys(staff)) {
    people[name] = await sign_in(app, { name, email: `${name}@bigco.test`, organization });
  }
  const admin = people.admin_ada as Person;

  const rooms = {} as Record<Department, string>;
  for (const department of departments) {
    rooms[department] = await create_room(app, admin, department);
  }
  for (const [name, member_of] of Object.entries(staff)) {
    if (name === admin.name) continue;
    for (const department of member_of) {
      await add_to_room(app, admin, rooms[department], people[name] as Person);
    }
  }

  const workspace_id = (await read_data(app, admin.headers, 'GET', '/v1/workspace')).workspace_id;
  const app_ids = {
    github: await create_catalog_app(db, 'github'),
    gmail: await create_catalog_app(db, 'gmail'),
    notion: await create_catalog_app(db, 'notion'),
    stripe: await create_catalog_app(db, 'stripe'),
  };
  const seeds = [
    { connection_id: connection_ids.github, app_id: app_ids.github, name: 'GitHub org' },
    { connection_id: connection_ids.gmail_hr, app_id: app_ids.gmail, name: 'Gmail (people ops)' },
    { connection_id: connection_ids.notion, app_id: app_ids.notion, name: 'Notion' },
    { connection_id: connection_ids.stripe, app_id: app_ids.stripe, name: 'Stripe' },
    {
      connection_id: connection_ids.gmail_second,
      app_id: app_ids.gmail,
      name: 'Gmail (billing alias)',
    },
    { connection_id: connection_ids.personal_gmail, app_id: app_ids.gmail, name: "Ada's Gmail" },
  ];
  for (const seed of seeds) {
    await create_connection(db, {
      workspace_id,
      app_id: seed.app_id,
      connection_id: seed.connection_id,
      connection_name: seed.name,
      connected_by: admin.user_id,
    });
  }

  const scope = (connection_id: string, body: unknown) =>
    read_data(app, admin.headers, 'PUT', `/v1/access/connection/${connection_id}`, body);
  await scope(connection_ids.github, share_with_projects([rooms.search, rooms.cloud]));
  await scope(connection_ids.gmail_hr, share_with_projects([rooms.hr]));
  await scope(connection_ids.notion, share_with_everyone());
  await scope(connection_ids.stripe, share_with_projects([rooms.legal]));
  await scope(connection_ids.gmail_second, share_with_everyone());
  await scope(connection_ids.personal_gmail, {
    shared_with_everyone_in_the_workspace: false,
    shared_with: [{ person: admin.user_id, can: 'manage' }],
  });

  const visible_rooms = await read_data(app, admin.headers, 'GET', '/v1/projects');
  const admin_personal_room = visible_rooms.find(
    (room: { personal_for_user_id: string | null }) => room.personal_for_user_id === admin.user_id,
  )?.project_id;
  if (!admin_personal_room) throw new Error(`${admin.name} has no personal room`);

  return {
    db,
    app,
    workspace_id,
    admin,
    people,
    rooms,
    admin_personal_room,
    room_of: (department, occupants) => ({
      project: [rooms[department]],
      agent: [],
      user: occupants.map((name) => (people[name] as Person).user_id),
    }),
  };
}
