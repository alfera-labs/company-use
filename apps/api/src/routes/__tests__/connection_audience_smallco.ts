import {
  type ApiApp,
  add_to_room,
  create_api,
  create_room,
  type Person,
  type ResourceSharing,
  read_data,
  sign_in,
} from '@api/routes/__tests__/connection_audience_org';
import type { Database } from '@coworker/core/db/connection';
import { workspace_members } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';

const organization = 'org_bigco';

export type Smallco = {
  db: Database;
  app: ApiApp;
  workspace_id: string;
  ada: Person;
  bo: Person;
  cleo: Person;
  dev_room: string;
  ads_room: string;
  hr_room: string;
  sharing_path: (connection_id: string) => string;
  read_sharing: (person: Person, connection_id: string) => Promise<ResourceSharing>;
};

export async function build_smallco(): Promise<Smallco> {
  const { db, app } = await create_api();
  const ada = await sign_in(app, { name: 'ada', email: 'ada@bigco.test', organization });
  const bo = await sign_in(app, { name: 'bo', email: 'bo@bigco.test', organization });
  const cleo = await sign_in(app, { name: 'cleo', email: 'cleo@bigco.test', organization });
  const workspace_id = (await read_data(app, ada.headers, 'GET', '/v1/workspace')).workspace_id;

  await db
    .update(workspace_members)
    .set({ member_role: 'owner' })
    .where(
      and(
        eq(workspace_members.workspace_id, workspace_id),
        eq(workspace_members.user_id, bo.user_id),
      ),
    );

  const dev_room = await create_room(app, ada, 'engineering');
  const ads_room = await create_room(app, ada, 'ads');
  const hr_room = await create_room(app, ada, 'people');
  await add_to_room(app, ada, dev_room, cleo);

  const sharing_path = (connection_id: string) => `/v1/access/connection/${connection_id}`;
  return {
    db,
    app,
    workspace_id,
    ada,
    bo,
    cleo,
    dev_room,
    ads_room,
    hr_room,
    sharing_path,
    read_sharing: (person, connection_id) =>
      read_data(app, person.headers, 'GET', sharing_path(connection_id)),
  };
}
