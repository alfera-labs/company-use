import {
  is_provider_trigger,
  refuse_provider_triggers_above_plan_limit,
} from '@api/services/automations/app_trigger_limit';
import {
  capture_automation_creation_audience,
  session_id_of,
} from '@api/services/automations/automation_creation_audience';
import {
  type CreateAutomationInput,
  create_automation_input_schema,
  type UpdateAutomationInput,
  update_automation_input_schema,
} from '@api/services/automations/automation_input';
import { refuse_changing_another_persons_automation } from '@api/services/automations/automation_owner_permission';
import {
  type AutomationWithTriggers,
  found,
  read_workspace_automation,
  set_workspace_automation_status,
} from '@api/services/automations/automation_status_service';
import { resign_automation_trigger_authority } from '@api/services/automations/automation_trigger_authority';
import { replace_automation_triggers } from '@api/services/automations/automation_trigger_replacement';
import {
  provision_automation_trigger,
  reopen_trigger_for_wiring,
  wire_reopened_trigger,
} from '@api/services/automations/automation_trigger_wiring';
import { plan_automation_triggers } from '@api/services/automations/automation_triggers';
import { create_workspace_system_automation_triggers_if_missing } from '@api/services/triggers/system_automation_schedules';
import type { Database } from '@coworker/core';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import { create_automation, update_automation } from '@coworker/core/db/queries/automation_writes';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { automation_statuses } from '@coworker/core/db/schema/automation_contracts';
import { ValidationError } from '@coworker/shared';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { carry_new_webhook_secrets } from '@runtime-platform/triggers/trigger_webhook_secret';
import type { z } from 'zod';

export {
  get_workspace_automation,
  list_workspace_automations,
} from '@api/services/automations/automation_read_service';
export {
  type AutomationWithTriggers,
  delete_workspace_automation,
  read_workspace_automation,
  set_workspace_automation_status,
} from '@api/services/automations/automation_status_service';

export async function create_workspace_automation(
  db: Database,
  raw_input: CreateAutomationInput,
): Promise<AutomationWithTriggers> {
  const parsed = create_automation_input_schema.safeParse(raw_input);
  if (!parsed.success) throw new ValidationError('Invalid automation', parsed.error.flatten());
  const input = parsed.data;
  const written = await write_automation_and_triggers(db, input);
  await create_workspace_system_automation_triggers_if_missing(db, input);
  const triggers = await Promise.all(
    written.triggers.map(async (planned) => ({
      ...(await provision_automation_trigger(db, planned.trigger, planned.connected_account_id)),
      new_webhook_secret: planned.new_webhook_secret,
    })),
  );
  return { automation: written.automation, triggers };
}

async function write_automation_and_triggers(
  db: Database,
  input: z.output<typeof create_automation_input_schema>,
) {
  const { triggers: trigger_inputs, ...automation_fields } = input;
  const captured_audience = capture_automation_creation_audience({
    actor_id: automation_fields.actor_id,
    session_id: session_id_of(automation_fields.metadata),
    ...(input.gathering ? { gathering: input.gathering } : {}),
  });
  const fields_with_audience = {
    ...automation_fields,
    metadata: { ...automation_fields.metadata, ...captured_audience },
  };
  return db.transaction(async (transaction) => {
    const automation = await create_automation(transaction, fields_with_audience);
    const planned = await plan_automation_triggers(
      transaction,
      { ...input, automation_id: automation.automation_id },
      trigger_inputs,
    );
    const triggers = await Promise.all(
      planned.map(async (plan) => ({
        trigger: await create_trigger(transaction, plan.row),
        connected_account_id: plan.connected_account_id,
        new_webhook_secret: plan.new_webhook_secret,
      })),
    );
    return { automation, triggers };
  });
}

export async function provision_workspace_automation(
  db: Database,
  input: { workspace_id: string; automation_id: string; actor_id: string },
): Promise<AutomationWithTriggers> {
  const automation = await read_workspace_automation(db, input);
  await refuse_changing_another_persons_automation(db, automation, input.actor_id);
  const reopened = await db.transaction(async (transaction) => {
    const ears = await list_automation_triggers(transaction, input);
    await refuse_provider_triggers_above_plan_limit(transaction, {
      workspace_id: input.workspace_id,
      opening: ears.filter((ear) => is_provider_trigger(ear) && ear.trigger_status === 'error')
        .length,
      closing: 0,
      created_via: automation.created_via,
    });
    return Promise.all(
      ears.map((trigger) =>
        trigger.trigger_status === 'error'
          ? reopen_trigger_for_wiring(transaction, trigger, input.actor_id)
          : { trigger, connected_account_id: null },
      ),
    );
  });
  const triggers = await Promise.all(reopened.map((ear) => wire_reopened_trigger(db, ear)));
  const still_off = automation_statuses.find((status) => status === automation.automation_status);
  if (!still_off || still_off === 'enabled') return { automation, triggers };
  return set_workspace_automation_status(db, { ...input, automation_status: still_off });
}

export async function update_workspace_automation(
  db: Database,
  raw_input: UpdateAutomationInput,
): Promise<AutomationWithTriggers> {
  const parsed = update_automation_input_schema.safeParse(raw_input);
  if (!parsed.success) throw new ValidationError('Invalid automation', parsed.error.flatten());
  const input = parsed.data;
  const current = await read_workspace_automation(db, input);
  await refuse_changing_another_persons_automation(db, current, input.actor_id);
  const { metadata, triggers: wanted_triggers, gathering, ...fields } = input;
  const ears_before = await list_automation_triggers(db, input);
  const automation = await update_automation(db, {
    ...fields,
    ...(metadata === undefined ? {} : { metadata: { ...current.metadata, ...metadata } }),
  });
  const updated = found(automation);
  const ears_after = wanted_triggers
    ? await replace_automation_triggers(
        db,
        {
          workspace_id: updated.workspace_id,
          agent_id: updated.agent_id,
          automation_id: updated.automation_id,
          automation_name: updated.automation_name,
          instruction: updated.instruction,
          actor_id: input.actor_id,
          created_via: updated.created_via,
          gathering,
        },
        wanted_triggers,
      )
    : ears_before;
  const triggers = await sign_after_behavior_edit(db, {
    ears_before,
    ears_after,
    instruction_changed: updated.instruction !== current.instruction,
    actor_id: input.actor_id,
    instruction: updated.instruction,
  });
  const saved =
    wanted_triggers && updated.automation_status !== 'enabled'
      ? await set_workspace_automation_status(db, {
          ...input,
          automation_status: updated.automation_status as (typeof automation_statuses)[number],
        })
      : { automation: updated, triggers };
  return { ...saved, triggers: carry_new_webhook_secrets(ears_after, saved.triggers) };
}

async function sign_after_behavior_edit(
  db: Database,
  input: {
    ears_before: TriggerRow[];
    ears_after: TriggerRow[];
    instruction_changed: boolean;
    actor_id: string;
    instruction: string;
  },
): Promise<TriggerRow[]> {
  const before = new Set(input.ears_before.map((ear) => ear.trigger_id));
  const ears_changed =
    input.ears_after.length !== before.size ||
    input.ears_after.some((ear) => !before.has(ear.trigger_id));
  if (!input.instruction_changed && !ears_changed) return input.ears_after;
  return resign_automation_trigger_authority(db, input.ears_after, {
    actor_id: input.actor_id,
    instruction: input.instruction,
  });
}
