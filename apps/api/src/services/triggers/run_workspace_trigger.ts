import { fire_trigger } from '@api/services/triggers/fire_trigger';
import {
  get_workspace_trigger,
  reject_system_managed_trigger,
  scheduled_agent_task_handler,
} from '@api/services/triggers/trigger_service';
import type { Database } from '@coworker/core';
import { AppError, ValidationError } from '@coworker/shared';

export async function run_workspace_trigger(
  db: Database,
  input: { workspace_id: string; trigger_id: string; occurrence_key: string },
) {
  const trigger = await get_workspace_trigger(db, input.workspace_id, input.trigger_id);
  reject_system_managed_trigger(trigger);
  if (trigger.trigger_config.starts_job_handler !== scheduled_agent_task_handler) {
    throw new ValidationError('This trigger does not run an agent task.');
  }
  if (trigger.trigger_status !== 'enabled') {
    throw new AppError('trigger_not_enabled', 'Enable the task before running it.', 409);
  }
  const fired = await fire_trigger(db, trigger, {
    occurrence_key: `manual:${input.occurrence_key}`,
  });
  if (!fired) throw new ValidationError('The task has no job handler.');
  return fired;
}
