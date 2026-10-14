import {
  remove_trigger,
  reprovision_trigger_schedule,
  schedule_new_trigger,
} from '@api/services/scheduling';
import {
  build_config,
  is_retired_system_schedule,
  matches_schedule,
  type SystemAutomationSchedule,
  schedule_expression_of,
  system_automation_schedules,
} from '@api/services/triggers/system_automation_schedule_records';
import { resolve_workspace_timezone } from '@api/services/triggers/trigger_service';
import { type Database, triggers as triggers_table } from '@coworker/core';
import { upsert_default_agent_for_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_triggers } from '@coworker/core/db/queries/trigger_reads';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import type { TriggerConfigData } from '@coworker/core/db/schema/json_column_types';
import { create_logger, format_error_message } from '@coworker/shared';
import { eq } from 'drizzle-orm';

type TriggerRow = typeof triggers_table.$inferSelect;

const log = create_logger('system_automation_schedules');

export async function create_workspace_system_automation_triggers(
  db: Database,
  input: { workspace_id: string; actor_id: string },
) {
  const agent = await upsert_default_agent_for_workspace(db, {
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
  });
  const timezone = await resolve_workspace_timezone(db, input.workspace_id);
  const existing = await list_triggers(db, input.workspace_id);

  for (const retired of existing.filter(is_retired_system_schedule)) {
    await remove_trigger(db, { workspace_id: input.workspace_id, trigger_id: retired.trigger_id });
  }

  const provisioned: TriggerRow[] = [];
  for (const schedule of system_automation_schedules) {
    provisioned.push(
      await provision_one_schedule(db, {
        workspace_id: input.workspace_id,
        agent_id: agent.agent_id,
        timezone,
        schedule,
        existing: existing.find((trigger) => matches_schedule(trigger, schedule)) ?? null,
        actor_id: input.actor_id,
      }),
    );
  }
  return provisioned;
}

export async function create_workspace_system_automation_triggers_if_missing(
  db: Database,
  input: { workspace_id: string; actor_id: string },
) {
  const existing = await list_triggers(db, input.workspace_id);
  const has_all = system_automation_schedules.every((schedule) =>
    existing.some((trigger) => matches_schedule(trigger, schedule)),
  );
  if (has_all) return;
  try {
    await create_workspace_system_automation_triggers(db, input);
  } catch (error) {
    log.error('the workspace system schedules could not be created', {
      workspace_id: input.workspace_id,
      error: format_error_message(error),
    });
  }
}

async function provision_one_schedule(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    timezone: string;
    schedule: SystemAutomationSchedule;
    existing: TriggerRow | null;
    actor_id: string;
  },
) {
  const trigger_config = build_config(input.schedule, input.timezone);
  if (input.existing) {
    const trigger = await update_config_if_stale(
      db,
      input.existing,
      trigger_config,
      input.actor_id,
    );
    await reprovision_trigger_schedule(trigger);
    return trigger;
  }

  const trigger = await create_trigger(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    trigger_name: input.schedule.trigger_name,
    trigger_type: 'schedule',
    schedule_expression: schedule_expression_of(input.workspace_id, input.schedule),
    trigger_config,
    trigger_source: {
      kind: 'system',
      source: 'system_automation_provisioning',
      purpose: input.schedule.purpose,
    },
    trigger_target: { kind: 'agent_run', agent_id: input.agent_id },
    actor_id: input.actor_id,
  });
  await schedule_new_trigger(db, trigger);
  return trigger;
}

async function update_config_if_stale(
  db: Database,
  trigger: TriggerRow,
  trigger_config: TriggerConfigData,
  actor_id: string,
) {
  if (trigger.trigger_config.timezone === trigger_config.timezone) return trigger;
  const [updated] = await db
    .update(triggers_table)
    .set({ trigger_config, last_updated_time: new Date(), last_updated_by: actor_id })
    .where(eq(triggers_table.trigger_id, trigger.trigger_id))
    .returning();
  return updated ?? trigger;
}
