import {
  assert_audience_editor,
  assert_memory_scope_grantee_write_allowed,
  assert_parties_belong_to_workspace,
  read_resource_grants,
  read_resource_ref,
} from '@api/services/access/resource_audience';
import type { Database } from '@coworker/core/db/connection';
import {
  add_resource_grant,
  remove_resource_grant,
} from '@coworker/core/db/queries/resource_grant_entries';
import type { GrantHolder, SharingEntry } from '@coworker/core/db/queries/resource_grants';

type GranteeActor = {
  workspace_id: string;
  user_id: string;
  resource_type: string;
  resource_id: string;
};

export async function add_audience_grantee(
  db: Database,
  input: GranteeActor & { entry: SharingEntry },
) {
  const resource = await read_resource_ref(db, input);
  await assert_audience_editor(db, {
    workspace_id: input.workspace_id,
    user_id: input.user_id,
    resource,
  });
  await assert_memory_scope_grantee_write_allowed(db, {
    workspace_id: input.workspace_id,
    resource_type: resource.resource_type,
    resource_id: resource.resource_id,
    grantee_type: input.entry.grantee_type,
  });
  await assert_parties_belong_to_workspace(db, {
    workspace_id: input.workspace_id,
    parties: [input.entry],
  });
  await add_resource_grant(db, {
    workspace_id: input.workspace_id,
    resource_type: resource.resource_type,
    resource_id: resource.resource_id,
    ...input.entry,
    actor_id: input.user_id,
  });
  return read_resource_grants(db, { workspace_id: input.workspace_id, ...resource });
}

export async function remove_audience_grantee(
  db: Database,
  input: GranteeActor & { grantee: GrantHolder },
) {
  const resource = await read_resource_ref(db, input);
  await assert_audience_editor(db, {
    workspace_id: input.workspace_id,
    user_id: input.user_id,
    resource,
  });
  await assert_memory_scope_grantee_write_allowed(db, {
    workspace_id: input.workspace_id,
    resource_type: resource.resource_type,
    resource_id: resource.resource_id,
    grantee_type: input.grantee.grantee_type,
  });
  await remove_resource_grant(db, {
    workspace_id: input.workspace_id,
    resource_type: resource.resource_type,
    resource_id: resource.resource_id,
    ...input.grantee,
  });
  return read_resource_grants(db, { workspace_id: input.workspace_id, ...resource });
}
