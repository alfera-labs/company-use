import type { DatabaseExecutor } from '@coworker/core';
import { type UpdateTriggerInput, update_trigger } from '@coworker/core/db/queries/trigger_writes';
import { read_trigger_schedule, type TriggerRow } from '@runtime-platform/events/trigger_ingress';

/**
 * Writes an edit of a trigger. When the edit changed when the trigger runs, the stored next run
 * is forgotten: it was worked out from the old schedule, and the scheduler would run the task
 * once more at the old time. The scheduler works it out again from the new schedule. An edit
 * that leaves the schedule as it is keeps the stored time, so a run that is due is not lost.
 */
export function update_trigger_after_edit(
  db: DatabaseExecutor,
  current_trigger: TriggerRow,
  next_trigger: TriggerRow,
  input: UpdateTriggerInput,
): Promise<TriggerRow> {
  const schedule_changed =
    JSON.stringify(read_trigger_schedule(current_trigger)) !==
    JSON.stringify(read_trigger_schedule(next_trigger));
  return update_trigger(db, { ...input, ...(schedule_changed ? { next_run_time: null } : {}) });
}
