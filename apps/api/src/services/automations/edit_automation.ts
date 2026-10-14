import type { UpdateAutomationInput } from '@api/services/automations/automation_input';
import {
  type AutomationWithTriggers,
  set_workspace_automation_status,
  update_workspace_automation,
} from '@api/services/automations/automation_service';
import type { Database } from '@coworker/core';

export async function edit_workspace_automation(
  db: Database,
  input: UpdateAutomationInput & { automation_status?: 'enabled' | 'paused' | undefined },
): Promise<AutomationWithTriggers> {
  const { automation_status, ...fields } = input;
  const identity = {
    workspace_id: input.workspace_id,
    automation_id: input.automation_id,
    actor_id: input.actor_id,
  };
  const status_changed = automation_status
    ? await set_workspace_automation_status(db, { ...identity, automation_status })
    : null;
  const content_fields = Object.keys(fields).filter((key) => !(key in identity));
  if (content_fields.length === 0 && status_changed) return status_changed;
  return update_workspace_automation(db, fields);
}
