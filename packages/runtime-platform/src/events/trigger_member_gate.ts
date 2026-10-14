import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { Database } from '@coworker/core';
import { find_api_key_by_id } from '@coworker/core/db/queries/api_keys';
import { read_task_people } from '@coworker/core/db/queries/task_people';
import type { DueScheduleTrigger } from '@coworker/core/db/queries/trigger_scheduling';
import { update_trigger_status } from '@coworker/core/db/queries/trigger_writes';
import { get_user } from '@coworker/core/db/queries/users';
import { workspace_member_is_active } from '@coworker/core/db/queries/workspace_membership';

const scheduler_actor_id = 'system:scheduler';

/**
 * In team mode a scheduled task works for the person who made it and the person who last
 * changed it, so a task whose person has left the team must not start work. Such a task is
 * switched off here instead of fired.
 * A task no person made (the system's own) fires as before, and so does every task outside
 * team mode.
 */
export async function keep_scheduled_tasks_of_current_members(
  db: Database,
  due: DueScheduleTrigger[],
): Promise<DueScheduleTrigger[]> {
  if (!is_team_mode_switched_on()) return due;
  // Two lookups for each due task, all at once. Read every maker in one query when a
  // team has hundreds of tasks due in the same minute.
  const maker_left = await Promise.all(
    due.map((trigger) => task_people_have_left_the_team(db, trigger)),
  );
  const tasks_of_people_who_left = due.filter((_trigger, index) => maker_left[index]);
  await Promise.all(
    tasks_of_people_who_left.map((trigger) =>
      update_trigger_status(db, {
        workspace_id: trigger.workspace_id,
        trigger_id: trigger.trigger_id,
        trigger_status: 'disabled',
        actor_id: scheduler_actor_id,
      }),
    ),
  );
  return due.filter((_trigger, index) => !maker_left[index]);
}

type TaskOfPeople = {
  workspace_id: string;
  created_by: string;
  metadata: Record<string, unknown> | null;
};

/**
 * True in team mode when the person who made a scheduled task, or the last person who changed
 * it, is no longer an active member. A task no person made (the system's own) is nobody's to
 * leave. Outside team mode the answer is always false, and the database is not asked.
 */
export async function task_people_have_left_the_team(
  db: Database,
  trigger: TaskOfPeople,
): Promise<boolean> {
  if (!is_team_mode_switched_on()) return false;
  const people = read_task_people(trigger);
  const person_ids = [people.made_by, people.last_changed_by].filter(
    (person_id): person_id is string => person_id !== null,
  );
  const left = await Promise.all(
    person_ids.map((user_id) => person_has_left(db, trigger.workspace_id, user_id)),
  );
  return left.some(Boolean);
}

async function person_has_left(db: Database, workspace_id: string, user_id: string) {
  if (!(await get_user(db, user_id))) return false;
  return !(await workspace_member_is_active(db, { workspace_id, user_id }));
}

/** The reason a scheduled task must not start because of who is behind it, or null. */
export async function find_why_task_people_left(
  db: Database,
  trigger: TaskOfPeople,
): Promise<string | null> {
  return (await task_people_have_left_the_team(db, trigger))
    ? 'The person who made this task, or who last changed it, is no longer on the team.'
    : null;
}

/**
 * True in team mode when the sender of a waiting message may not start a run any more: a
 * person who is not an active member, or an API key that is revoked or whose maker is out. A
 * message can wait in a queue while its sender is removed, and the job that starts its run is
 * the last place to stop it. Outside team mode the answer is always false.
 */
export async function message_sender_has_left_the_team(
  db: Database,
  input: { workspace_id: string; sender_id: string },
): Promise<boolean> {
  if (!is_team_mode_switched_on()) return false;
  const api_key = await find_api_key_by_id(db, input.sender_id);
  if (!api_key)
    return !(await workspace_member_is_active(db, { ...input, user_id: input.sender_id }));
  if (api_key.key_status !== 'active') return true;
  return person_has_left(db, input.workspace_id, api_key.created_by);
}

export const sender_left_the_team = {
  code: 'sender_not_on_the_team',
  message: 'The sender of this message is no longer on the team, so it started no run.',
} as const;
