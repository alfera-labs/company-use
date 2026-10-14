import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { provision_volume } from '@coworker/runtime-platform';
import { AppError, create_logger } from '@coworker/shared';

const log = create_logger('workspace_volume_provisioning');

export async function provision_workspace_volume(
  db: Database,
  workspace_id: string,
  actor_id: string,
) {
  if (!env.COWORKER_PERSISTENT_WORKSPACES_ENABLED) return null;
  try {
    return await provision_volume(db, { workspace_id, actor_id });
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'volume_not_active') throw error;
    log.error('Workspace volume is not active; sign-in continues while runs stay blocked.', {
      workspace_id,
    });
    return null;
  }
}
