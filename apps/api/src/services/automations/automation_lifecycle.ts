import {
  create_workspace_automation,
  delete_workspace_automation,
  set_workspace_automation_status,
  update_workspace_automation,
} from '@api/services/automations/automation_service';
import { run_workspace_automation_now } from '@api/services/automations/run_automation_now';
import { reprovision_trigger_schedule } from '@api/services/scheduling/trigger_lifecycle';
import { with_team_task_rule } from '@api/services/team/team_tasks';
import {
  create_agent_scheduled_task,
  delete_agent_scheduled_task,
  list_agent_scheduled_tasks,
  update_agent_scheduled_task,
} from '@api/services/triggers/trigger_service';
import type { AutomationLifecycle } from '@runtime-platform/automations/automation_lifecycle';

export const automation_lifecycle: AutomationLifecycle = {
  create_automation: create_workspace_automation,
  update_automation: update_workspace_automation,
  set_automation_status: set_workspace_automation_status,
  delete_automation: delete_workspace_automation,
  run_automation_now: run_workspace_automation_now,
  ...with_team_task_rule({
    create_scheduled_task: create_agent_scheduled_task,
    update_scheduled_task: update_agent_scheduled_task,
    delete_scheduled_task: delete_agent_scheduled_task,
    list_scheduled_tasks: list_agent_scheduled_tasks,
  }),
  reprovision_trigger_schedule,
};
