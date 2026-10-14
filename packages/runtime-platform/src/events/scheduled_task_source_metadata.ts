import type { Database } from '@coworker/core';
import { read_user_timezone } from '@coworker/core/db/queries/user_timezone';
import { read_trigger_schedule } from '@runtime-platform/events/trigger_ingress';

type ScheduledTask = Parameters<typeof read_trigger_schedule>[0] & { created_by: string };

/**
 * What a run of a scheduled task knows about where it comes from: the task, what the caller
 * adds (who started it, what it was allowed when it was scheduled), and the time zone it tells
 * times in. That is the time zone the task is scheduled in, or else the one stored for the
 * person who made it. Nobody is present in the run, so without it the coworker reads the
 * clock of its machine and answers in UTC.
 */
export async function build_scheduled_task_source_metadata<Added extends object>(
  db: Database,
  task: ScheduledTask,
  added: Added,
) {
  const local_timezone =
    read_trigger_schedule(task)?.timezone ?? (await read_user_timezone(db, task.created_by));
  return {
    trigger_id: task.trigger_id,
    ...added,
    ...(local_timezone ? { local_timezone } : {}),
  };
}
