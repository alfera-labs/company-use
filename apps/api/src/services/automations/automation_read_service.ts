import {
  type AutomationWithTriggers,
  read_workspace_automation,
} from '@api/services/automations/automation_status_service';
import {
  attach_trigger_apps,
  type TriggerWithApp,
} from '@api/services/automations/automation_trigger_apps';
import type { Database } from '@coworker/core';
import { list_automations } from '@coworker/core/db/queries/automation_reads';
import { count_runs_by_automation } from '@coworker/core/db/queries/automation_runs';
import {
  list_automation_triggers,
  list_automation_triggers_for_workspace,
} from '@coworker/core/db/queries/automation_triggers';

type AutomationIdentity = { workspace_id: string; automation_id: string };

export async function list_workspace_automations(db: Database, workspace_id: string) {
  const all_rows = await list_automations(db, { workspace_id });
  const automation_rows = all_rows.filter((automation) => automation.created_via !== 'system');
  const activity = await count_runs_by_automation(db, {
    workspace_id,
    automation_ids: automation_rows.map((automation) => automation.automation_id),
  });
  const by_automation = new Map(activity.map((row) => [row.automation_id, row]));
  const ears = await attach_trigger_apps(
    db,
    await list_automation_triggers_for_workspace(db, workspace_id),
  );
  return automation_rows.map((automation) => ({
    ...automation,
    run_count: by_automation.get(automation.automation_id)?.run_count ?? 0,
    last_run_time: by_automation.get(automation.automation_id)?.last_run_time ?? null,
    triggers: ears.filter((ear) => ear.automation_id === automation.automation_id),
  }));
}

export async function get_workspace_automation(
  db: Database,
  input: AutomationIdentity,
): Promise<AutomationWithTriggers & { triggers: TriggerWithApp[] }> {
  const automation = await read_workspace_automation(db, input);
  return {
    automation,
    triggers: await attach_trigger_apps(db, await list_automation_triggers(db, input)),
  };
}
