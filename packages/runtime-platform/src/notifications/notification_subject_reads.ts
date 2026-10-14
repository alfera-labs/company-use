import type { Database } from '@coworker/core';
import { get_automation } from '@coworker/core/db/queries/automation_reads';
import type { Notification } from '@runtime-platform/notifications/notification_body';
import type { NotificationRules } from '@runtime-platform/notifications/notification_rules_file';

export async function find_the_person_it_is_for(
  db: Database,
  input: { workspace_id: string; actor_id: string },
  notification: Notification,
): Promise<string | null> {
  if (notification.principal_id) return notification.principal_id;
  const automation = notification.automation_id
    ? await get_automation(db, {
        workspace_id: input.workspace_id,
        automation_id: notification.automation_id,
      })
    : null;
  if (automation?.created_by.startsWith('user_')) return automation.created_by;
  return input.actor_id.startsWith('user_') ? input.actor_id : null;
}

export async function read_automation_the_policy_names(
  db: Database,
  workspace_id: string,
  policy: NotificationRules,
  notification: Notification,
): Promise<{ automation_name: string | null }> {
  const named_automations =
    policy.always_notify.length +
    policy.never_notify.length +
    Object.keys(policy.own_daily_limit).length;
  if (!notification.automation_id || named_automations === 0) return { automation_name: null };
  const automation = await get_automation(db, {
    workspace_id,
    automation_id: notification.automation_id,
  });
  return { automation_name: automation?.automation_name ?? null };
}
