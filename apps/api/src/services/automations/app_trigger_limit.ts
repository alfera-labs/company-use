import { default_app_trigger_limit } from '@coworker/config/plans';
import {
  type DatabaseExecutor,
  find_workspace_plan,
  lock_workspace_plan_capacity,
} from '@coworker/core';
import { count_open_provider_triggers } from '@coworker/core/db/queries/automation_triggers';
import type { CreateTriggerInput } from '@coworker/core/db/queries/trigger_writes';
import { ValidationError } from '@coworker/shared';

type TriggerShape = {
  trigger_type: string;
  trigger_config?: CreateTriggerInput['trigger_config'];
  trigger_status?: string | undefined;
};

export function is_provider_trigger(trigger: TriggerShape) {
  return (
    trigger.trigger_type === 'app_event' && !!trigger.trigger_config?.event_source?.trigger_slug
  );
}

export function is_open_provider_trigger(trigger: TriggerShape) {
  const closed = trigger.trigger_status === 'disabled' || trigger.trigger_status === 'error';
  return is_provider_trigger(trigger) && !closed;
}

export async function refuse_provider_triggers_above_plan_limit(
  db: DatabaseExecutor,
  input: { workspace_id: string; opening: number; closing: number; created_via: string },
) {
  if (input.opening === 0 || input.created_via === 'system') return;
  await lock_workspace_plan_capacity(db, input.workspace_id);
  const plan = await find_workspace_plan(db, input.workspace_id);
  const limit = plan ? plan.app_trigger_limit : default_app_trigger_limit;
  if (limit === null) return;
  const open = (await count_open_provider_triggers(db, input.workspace_id)) - input.closing;
  if (open + input.opening <= limit) return;
  const message =
    open >= limit
      ? `This workspace already has ${open} app triggers running. Pause or delete one to add another.`
      : `This workspace can run ${limit} app triggers at once and already has ${open}. Pause or delete ${open + input.opening - limit} to add these.`;
  throw new ValidationError(message, { limit, open, adding: input.opening });
}
