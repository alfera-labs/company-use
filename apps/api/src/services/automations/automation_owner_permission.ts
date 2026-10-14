import type { Database } from '@coworker/core';
import { is_workspace_administrator } from '@coworker/core/access/assert_project_manager';
import type { Automation } from '@coworker/core/db/queries/automation_reads';
import { AppError, is_another_persons_automation } from '@coworker/shared';

/**
 * An automation runs with the access of the person who set it up. Changing what it does, or
 * starting it, is acting as that person, so only they or a workspace owner or admin may.
 */
export async function refuse_changing_another_persons_automation(
  db: Database,
  automation: Automation,
  actor_id: string,
): Promise<void> {
  if (!is_another_persons_automation(automation, actor_id)) return;
  const administrator = { workspace_id: automation.workspace_id, user_id: actor_id };
  if (await is_workspace_administrator(db, administrator)) return;

  throw new AppError(
    'automation_access_denied',
    `"${automation.automation_name}" was set up by another person. Only they, or a workspace owner or admin, can change it or start it.`,
    403,
  );
}
