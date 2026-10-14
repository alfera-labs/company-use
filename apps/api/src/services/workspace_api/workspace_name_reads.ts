import type { Database } from '@coworker/core';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { find_workspace_profile } from '@coworker/core/db/queries/workspace_provisioning';

export async function read_api_workspace_name(db: Database, api_key: ApiKey) {
  const workspace = await find_workspace_profile(db, api_key.workspace_id);
  return workspace?.workspace_name ?? null;
}
