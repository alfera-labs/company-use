import {
  may_use_resource,
  type Participants,
  type ResourceUseVerdict,
} from '@coworker/core/access/may_use_resource';
import { read_resource_type_definition } from '@coworker/core/access/resource_types';
import type { Database } from '@coworker/core/db/connection';
import {
  list_grants_for_resource,
  read_grant_rules,
} from '@coworker/core/db/queries/resource_grants';

export type CheckResourceUseInput = {
  workspace_id: string;
  resource_type: string;
  resource_id: string;
  participants: Participants;
  owner_user_id?: string | null;
  room_private_to?: string | null | undefined;
};

export async function check_resource_use(
  db: Database,
  input: CheckResourceUseInput,
): Promise<ResourceUseVerdict> {
  const definition = read_resource_type_definition(input.resource_type);
  const rows = await list_grants_for_resource(db, {
    workspace_id: input.workspace_id,
    resource_type: input.resource_type,
    resource_id: input.resource_id,
  });
  return may_use_resource({
    default_access: definition.default_access,
    grants: read_grant_rules(rows),
    participants: input.participants,
    owner_user_id: input.owner_user_id,
    room_private_to: input.room_private_to,
  });
}
