import { automation_job_handler } from '@api/services/automations/app_event_trigger_plan';
import { refuse_changing_another_persons_automation } from '@api/services/automations/automation_owner_permission';
import { read_workspace_automation } from '@api/services/automations/automation_service';
import { fire_trigger } from '@api/services/triggers/fire_trigger';
import { type Database, set_scheduled_task_authority } from '@coworker/core';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { AppError, ValidationError } from '@coworker/shared';

export async function run_workspace_automation_now(
  db: Database,
  input: { workspace_id: string; automation_id: string; occurrence_key: string; actor_id: string },
) {
  const automation = await read_workspace_automation(db, input);
  await refuse_changing_another_persons_automation(db, automation, input.actor_id);
  if (automation.automation_status !== 'enabled') {
    throw new AppError(
      automation.automation_status === 'paused' ? 'automation_paused' : 'automation_not_enabled',
      `This automation is ${automation.automation_status}, so running it would do nothing. Enable it first — PATCH /v1/automations/${automation.automation_id} with {"automation_status": "enabled"}, or switch it on in the dashboard — then run it.`,
      409,
    );
  }
  const triggers = await list_automation_triggers(db, input);
  const manual_trigger =
    triggers.find((trigger) => trigger.trigger_type === 'manual') ??
    (await create_trigger(db, {
      workspace_id: input.workspace_id,
      agent_id: automation.agent_id,
      automation_id: automation.automation_id,
      trigger_name: automation.automation_name,
      trigger_type: 'manual',
      trigger_config: { starts_job_handler: automation_job_handler },
      trigger_source: set_scheduled_task_authority(
        { origin: 'automation', automation_id: automation.automation_id },
        input.actor_id,
        automation.instruction,
      ),
      actor_id: input.actor_id,
    }));
  const fired = await fire_trigger(db, manual_trigger, {
    occurrence_key: `manual:${input.occurrence_key}`,
  });
  if (!fired) throw new ValidationError('This automation has no job handler to run.');
  return fired;
}
