import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { Database, DatabaseExecutor } from '@coworker/core';
import {
  find_task_people,
  read_task_people,
  record_task_changed_by,
} from '@coworker/core/db/queries/task_people';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { AppError, is_workspace_administrator_role, NotFoundError } from '@coworker/shared';
import type { AutomationLifecycle } from '@runtime-platform/automations/automation_lifecycle';

type Person = { workspace_id: string; user_id: string };
type Task = { created_by: string; metadata: Record<string, unknown> | null };

/**
 * Whose scheduled tasks a person sees and manages in team mode. A task works on the clock with
 * the instruction of the person who made it, so a member sees and manages only the tasks they
 * made. An owner or an admin sees and manages every task. Whoever is not an active member (a
 * run no person started is one) sees and manages none.
 */
export async function read_whose_tasks_person_manages(
  db: DatabaseExecutor,
  person: Person,
): Promise<'every' | 'own' | 'none'> {
  const role = await find_active_workspace_member_role(db, person);
  if (is_workspace_administrator_role(role)) return 'every';
  return role ? 'own' : 'none';
}

export async function keep_tasks_person_manages<T extends Task>(
  db: DatabaseExecutor,
  person: Person,
  tasks: T[],
): Promise<T[]> {
  const whose = await read_whose_tasks_person_manages(db, person);
  if (whose === 'every') return tasks;
  if (whose === 'none') return [];
  return tasks.filter((task) => read_task_people(task).made_by === person.user_id);
}

/** A task of another person answers "not found" to a member, as if it were not there. */
export async function require_task_person_manages(
  db: DatabaseExecutor,
  person: Person,
  trigger_id: string,
): Promise<void> {
  const people = await find_task_people(db, { workspace_id: person.workspace_id, trigger_id });
  if (!people) return;
  const whose = await read_whose_tasks_person_manages(db, person);
  if (whose === 'every' || (whose === 'own' && people.made_by === person.user_id)) return;
  throw new NotFoundError('Scheduled task');
}

type TaskLifecycle = Pick<
  AutomationLifecycle,
  | 'create_scheduled_task'
  | 'update_scheduled_task'
  | 'delete_scheduled_task'
  | 'list_scheduled_tasks'
>;

/**
 * Puts the same rule in front of the coworker's own task tools, so a member's coworker cannot
 * list, change or delete another member's task either. The person is the one the run acts for.
 * A run no person started makes and manages no task in team mode: such a task would be
 * nobody's, and nothing would switch it off when a person leaves. Outside team mode the
 * lifecycle is handed back as it is.
 */
export function with_team_task_rule<Lifecycle extends TaskLifecycle>(
  lifecycle: Lifecycle,
): Lifecycle {
  const person_of = (input: { workspace_id: string; actor_id?: string }) => ({
    workspace_id: input.workspace_id,
    user_id: input.actor_id ?? '',
  });
  return {
    ...lifecycle,
    create_scheduled_task: async (db, input) => {
      if (is_team_mode_switched_on()) await refuse_a_task_of_nobody(db, person_of(input));
      return lifecycle.create_scheduled_task(db, input);
    },
    list_scheduled_tasks: async (db, input) => {
      const tasks = await lifecycle.list_scheduled_tasks(db, input);
      return is_team_mode_switched_on()
        ? keep_tasks_person_manages(db, person_of(input), tasks)
        : tasks;
    },
    update_scheduled_task: async (db, input) => {
      if (!is_team_mode_switched_on()) return lifecycle.update_scheduled_task(db, input);
      await require_task_person_manages(db, person_of(input), input.trigger_id);
      const task = await lifecycle.update_scheduled_task(db, input);
      await record_task_changed_by(db, { ...input, user_id: input.actor_id });
      return task;
    },
    delete_scheduled_task: async (db, input) => {
      if (is_team_mode_switched_on()) {
        await require_task_person_manages(db, person_of(input), input.trigger_id);
      }
      return lifecycle.delete_scheduled_task(db, input);
    },
  };
}

async function refuse_a_task_of_nobody(db: Database, person: Person) {
  if ((await read_whose_tasks_person_manages(db, person)) !== 'none') return;
  throw new AppError(
    'team_access_denied',
    'Only a person on the team can make a scheduled task. A run that no person started cannot.',
    403,
  );
}
