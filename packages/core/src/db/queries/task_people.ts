import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { triggers } from '@coworker/core/db/schema';
import { merge_metadata } from '@coworker/core/db/schema/common';
import { and, eq, sql } from 'drizzle-orm';

const last_changed_by_key = 'last_changed_by_user_id';

export type TaskPeople = { made_by: string; last_changed_by: string | null };

type TaskKey = { workspace_id: string; trigger_id: string };

/** The people behind a scheduled task: who made it, and the last person who changed it. */
export function read_task_people(trigger: {
  created_by: string;
  metadata: Record<string, unknown> | null;
}): TaskPeople {
  const last_changed_by = trigger.metadata?.[last_changed_by_key];
  return {
    made_by: trigger.created_by,
    last_changed_by: typeof last_changed_by === 'string' ? last_changed_by : null,
  };
}

export async function find_task_people(
  db: DatabaseExecutor,
  input: TaskKey,
): Promise<TaskPeople | null> {
  const [trigger] = await db
    .select({ created_by: triggers.created_by, metadata: triggers.metadata })
    .from(triggers)
    .where(
      and(eq(triggers.workspace_id, input.workspace_id), eq(triggers.trigger_id, input.trigger_id)),
    )
    .limit(1);
  return trigger ? read_task_people(trigger) : null;
}

/**
 * Keeps who last changed a task. The task goes on working with that person's instruction, so
 * it must stop when that person leaves the team, whoever made it first. The scheduler writes
 * the lifecycle columns too, so they cannot say this.
 */
export async function record_task_changed_by(
  db: DatabaseExecutor,
  input: TaskKey & { user_id: string },
): Promise<void> {
  await db
    .update(triggers)
    .set({
      metadata: merge_metadata(triggers.metadata, { [last_changed_by_key]: input.user_id }),
      last_updated_time: sql`now()`,
      last_updated_by: input.user_id,
    })
    .where(
      and(eq(triggers.workspace_id, input.workspace_id), eq(triggers.trigger_id, input.trigger_id)),
    );
}

/** True for a task this person made, or was the last to change. */
export function task_is_of_person(user_id: string) {
  return sql`(${triggers.created_by} = ${user_id} or ${triggers.metadata} ->> ${last_changed_by_key} = ${user_id})`;
}
