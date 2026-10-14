import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { attach_workspace } from '@api/middleware';
import {
  keep_tasks_person_manages,
  require_task_person_manages,
} from '@api/services/team/team_tasks';
import { list_triggers_without_secrets } from '@api/services/triggers';
import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import { record_task_changed_by } from '@coworker/core/db/queries/task_people';
import type { Context, MiddlewareHandler } from 'hono';

function person_of(c: Context<ApiEnv>) {
  return { workspace_id: c.get('workspace_id'), user_id: c.get('user_id') };
}

/**
 * In team mode the list of scheduled tasks holds only the tasks the person manages: their own,
 * or every task for an owner or an admin. This answers the list itself, so the route behind it
 * never hands a member the whole list. Outside team mode, and for every other method, the
 * request goes on untouched.
 */
export const team_members_list_their_own_tasks: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (!is_team_mode_switched_on() || c.req.method !== 'GET') return next();
  await attach_workspace()(c, async () => {});
  const tasks = await list_triggers_without_secrets(c.get('db'), c.get('workspace_id'));
  return c.json(ok(await keep_tasks_person_manages(c.get('db'), person_of(c), tasks)));
};

/**
 * In team mode a member reads, changes, runs and deletes only a task they made. Another
 * person's task answers "not found". A change that went through is kept as the last change by
 * a person, so the task stops when that person leaves. Outside team mode nothing is checked.
 */
export const team_members_manage_their_own_tasks: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (!is_team_mode_switched_on()) return next();
  await attach_workspace()(c, async () => {});
  const trigger_id = c.req.param('trigger_id') ?? '';
  await require_task_person_manages(c.get('db'), person_of(c), trigger_id);
  await next();
  if (c.req.method === 'PATCH' && c.res.ok) {
    await record_task_changed_by(c.get('db'), { ...person_of(c), trigger_id });
  }
};
