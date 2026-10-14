import {
  is_provider_trigger,
  refuse_provider_triggers_above_plan_limit,
} from '@api/services/automations/app_trigger_limit';
import { refuse_changing_another_persons_automation } from '@api/services/automations/automation_owner_permission';
import { refuse_retiring_somebody_elses_automation } from '@api/services/automations/automation_retire_permission';
import { delete_automation_trigger } from '@api/services/automations/automation_trigger_wiring';
import { set_trigger_status } from '@api/services/scheduling';
import { create_workspace_system_automation_triggers_if_missing } from '@api/services/triggers/system_automation_schedules';
import type { Database } from '@coworker/core';
import { start_automation_budget_over } from '@coworker/core/db/queries/automation_budget';
import {
  type Automation,
  get_automation,
  list_automations_created_by_automation,
} from '@coworker/core/db/queries/automation_reads';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import {
  archive_automation,
  set_automation_status,
} from '@coworker/core/db/queries/automation_writes';
import { update_trigger, update_trigger_status } from '@coworker/core/db/queries/trigger_writes';
import type { AutomationStatus } from '@coworker/core/db/schema/automation_contracts';
import { create_logger, format_error_message, NotFoundError } from '@coworker/shared';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { plain_provider_error } from '@runtime-platform/triggers/provider_error_words';
import type { TriggerRowWithNewSecret } from '@runtime-platform/triggers/trigger_webhook_secret';

const log = create_logger('automation_status_service');
const live_automation_status: AutomationStatus = 'enabled';

type AutomationIdentity = { workspace_id: string; automation_id: string };
export type AutomationWrite = AutomationIdentity & { actor_id: string };
export type AutomationWithTriggers = {
  automation: Automation;
  triggers: TriggerRowWithNewSecret[];
};
export type AutomationTriggerRemoval = { trigger_id: string; removed: boolean; error?: string };

export async function set_workspace_automation_status(
  db: Database,
  input: AutomationWrite & { automation_status: AutomationStatus },
): Promise<AutomationWithTriggers> {
  const automation = await read_workspace_automation(db, input);
  await refuse_changing_another_persons_automation(db, automation, input.actor_id);
  if (input.automation_status === live_automation_status) {
    await write_enabled_under_plan_lock(db, { ...input, created_via: automation.created_via });
  }
  return move_automation(db, input);
}

async function write_enabled_under_plan_lock(
  db: Database,
  input: AutomationWrite & { automation_status: AutomationStatus; created_via: string },
) {
  await db.transaction(async (transaction) => {
    const ears = await list_automation_triggers(transaction, input);
    const switched_off = ears.filter((ear) => ear.trigger_status === 'disabled');
    await refuse_provider_triggers_above_plan_limit(transaction, {
      workspace_id: input.workspace_id,
      opening: switched_off.filter(is_provider_trigger).length,
      closing: 0,
      created_via: input.created_via,
    });
    for (const ear of switched_off) {
      const opened = { trigger_id: ear.trigger_id, trigger_status: 'enabled' as const };
      await update_trigger_status(transaction, { ...input, ...opened });
    }
    await set_automation_status(transaction, input);
  });
}

async function move_automation(
  db: Database,
  input: AutomationWrite & { automation_status: AutomationStatus },
): Promise<AutomationWithTriggers> {
  const trigger_status =
    input.automation_status === live_automation_status ? 'enabled' : 'disabled';
  const triggers = await Promise.all(
    (await list_automation_triggers(db, input)).map((trigger) =>
      move_one_ear(db, trigger, trigger_status, input.actor_id),
    ),
  );
  const automation = found(await set_automation_status(db, input));
  if (input.automation_status === live_automation_status) {
    await start_automation_budget_over(db, { ...input, now: new Date() });
    await create_workspace_system_automation_triggers_if_missing(db, input);
  } else {
    await stop_the_follow_ups(db, input);
  }
  return { automation, triggers };
}

async function stop_the_follow_ups(db: Database, input: AutomationWrite) {
  const children = await list_automations_created_by_automation(db, {
    workspace_id: input.workspace_id,
    parent_automation_id: input.automation_id,
  });
  for (const child of children) {
    await set_workspace_automation_status(db, {
      workspace_id: input.workspace_id,
      automation_id: child.automation_id,
      automation_status: 'paused',
      actor_id: input.actor_id,
    });
  }
}

async function move_one_ear(
  db: Database,
  trigger: TriggerRow,
  trigger_status: 'enabled' | 'disabled',
  actor_id: string,
): Promise<TriggerRow> {
  if (trigger.trigger_status === 'error') return trigger;
  try {
    return await set_trigger_status(db, {
      workspace_id: trigger.workspace_id,
      trigger_id: trigger.trigger_id,
      trigger_status,
      actor_id,
    });
  } catch (error) {
    const reason = plain_provider_error(format_error_message(error));
    const { workspace_id, trigger_id } = trigger;
    log.error('an ear refused to move with its automation', { trigger_id, reason });
    const trigger_config = { ...trigger.trigger_config, provisioning_error: reason };
    return update_trigger(db, {
      workspace_id,
      trigger_id,
      trigger_status: 'error',
      trigger_config,
      actor_id,
    });
  }
}

export async function delete_workspace_automation(
  db: Database,
  input: AutomationWrite,
): Promise<{ automation: Automation; triggers: AutomationTriggerRemoval[] }> {
  const automation = await read_workspace_automation(db, input);
  refuse_retiring_somebody_elses_automation(automation, input.actor_id);
  await refuse_changing_another_persons_automation(db, automation, input.actor_id);
  await stop_the_follow_ups(db, input);
  const triggers: AutomationTriggerRemoval[] = [];
  for (const trigger of await list_automation_triggers(db, input)) {
    triggers.push(await remove_one_ear(db, trigger));
  }
  return { automation: found(await archive_automation(db, input)), triggers };
}

async function remove_one_ear(
  db: Database,
  trigger: TriggerRow,
): Promise<AutomationTriggerRemoval> {
  try {
    await delete_automation_trigger(db, {
      workspace_id: trigger.workspace_id,
      trigger_id: trigger.trigger_id,
    });
    return { trigger_id: trigger.trigger_id, removed: true };
  } catch (error) {
    const reason = format_error_message(error);
    log.error('an ear survived its automation', { trigger_id: trigger.trigger_id, reason });
    return { trigger_id: trigger.trigger_id, removed: false, error: reason };
  }
}

export async function read_workspace_automation(db: Database, input: AutomationIdentity) {
  const automation = await get_automation(db, input);
  if (!automation || automation.automation_status === 'archived')
    throw new NotFoundError('Automation');
  return automation;
}

export function found(automation: Automation | null): Automation {
  if (!automation) throw new NotFoundError('Automation');
  return automation;
}
