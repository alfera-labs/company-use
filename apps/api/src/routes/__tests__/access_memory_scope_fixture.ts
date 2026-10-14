import {
  create_api,
  create_room,
  read_data,
  sign_in,
} from '@api/routes/__tests__/connection_audience_org';
import { create_scope_item } from '@coworker/core/db/__tests__/create_scope_item';
import type { Database } from '@coworker/core/db/connection';
import { replace_memory_scope_members_for_sweep } from '@coworker/core/db/queries/resource_grants_memory_scope_sweep';

export const group_scope_key = 'group:slack:T1:C1';

export async function build_workspace() {
  const { db, app } = await create_api();
  const admin = await sign_in(app, {
    name: 'ada',
    email: 'ada@acme.test',
    organization: 'org_acme',
  });
  const member = await sign_in(app, {
    name: 'bo',
    email: 'bo@acme.test',
    organization: 'org_acme',
  });
  const workspace_id = (await read_data(app, admin.headers, 'GET', '/v1/workspace')).workspace_id;
  const project_id = await create_room(app, admin, 'engineering');
  await create_scope_item(db, { workspace_id, actor_id: admin.user_id }, group_scope_key);
  return { db, app, admin, member, workspace_id, project_id };
}

export async function sweep_group_members(
  db: Database,
  input: { workspace_id: string; actor_id: string; swept_time: Date; member_ids: string[] },
) {
  await replace_memory_scope_members_for_sweep(db, {
    workspace_id: input.workspace_id,
    scope_key: group_scope_key,
    sweep_id: 'sweep_1',
    swept_time: input.swept_time,
    members: input.member_ids.map((grantee_id) => ({
      grantee_type: 'user' as const,
      grantee_id,
      member_kind: 'member' as const,
    })),
    actor_id: input.actor_id,
  });
}
