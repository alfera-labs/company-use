import type { ApiEnv } from '@api/lib/context';
import { refuse_changing_another_persons_automation } from '@api/services/automations/automation_owner_permission';
import { get_automation } from '@coworker/core/db/queries/automation_reads';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import type { MiddlewareHandler } from 'hono';

/**
 * A trigger that belongs to an automation is part of that automation. The trigger routes change
 * and delete any trigger row by id, so without this rule they went round the rule the automation
 * routes keep: only the person who set an automation up, or an owner or an admin, may change it.
 * A trigger of no automation (a scheduled task) passes untouched.
 */
export const only_its_owner_changes_an_automation_trigger: MiddlewareHandler<ApiEnv> = async (
  c,
  next,
) => {
  if (c.req.method === 'GET') return next();
  const db = c.get('db');
  const workspace_id = c.get('workspace_id');
  const trigger = await get_trigger_by_id(db, c.req.param('trigger_id') ?? '');
  const automation_id = trigger?.workspace_id === workspace_id ? trigger.automation_id : null;
  const automation = automation_id
    ? await get_automation(db, { workspace_id, automation_id })
    : null;
  if (automation)
    await refuse_changing_another_persons_automation(db, automation, c.get('user_id'));
  await next();
};
