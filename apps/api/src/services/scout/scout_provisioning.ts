import { reprovision_trigger_schedule, schedule_new_trigger } from '@api/services/scheduling';
import { resolve_workspace_timezone } from '@api/services/triggers/trigger_service';
import { add_schedule_jitter, type Database, triggers as triggers_table } from '@coworker/core';
import { upsert_default_agent_for_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import type { TriggerConfigData } from '@coworker/core/db/schema/json_column_types';
import {
  scout_config_key,
  scout_job_handler,
  scout_provisioning_actor,
  scout_provisioning_key,
  scout_trigger_purpose,
} from '@coworker/shared';
import { eq } from 'drizzle-orm';

type TriggerRow = typeof triggers_table.$inferSelect;

const scout_schedule_expression = '1 8,11,14,17 * * 1-5';
const scout_mode = 'autonomous_agent';

export async function create_workspace_scout_trigger(
  db: Database,
  input: { workspace_id: string; actor_id: string },
) {
  const agent = await upsert_default_agent_for_workspace(db, {
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
  });
  const timezone = await resolve_workspace_timezone(db, input.workspace_id);
  const existing = await find_scout_trigger(db, input.workspace_id, agent.agent_id);
  if (existing) {
    const trigger = await update_scout_config(db, existing, timezone);
    await reprovision_trigger_schedule(trigger);
    return trigger;
  }

  const trigger = await create_trigger(db, {
    workspace_id: input.workspace_id,
    agent_id: agent.agent_id,
    trigger_name: 'Agent scout',
    trigger_type: 'schedule',
    schedule_expression: add_schedule_jitter({
      cron_expression: scout_schedule_expression,
      workspace_id: input.workspace_id,
      window: 'full_hour',
    }),
    trigger_config: build_scout_trigger_config(timezone),
    trigger_source: {
      kind: 'system',
      source: 'onboarding_complete',
      purpose: scout_trigger_purpose,
    },
    trigger_target: { kind: 'agent_run', agent_id: agent.agent_id },
    actor_id: scout_provisioning_actor,
  });

  await schedule_new_trigger(db, trigger);
  return trigger;
}

async function find_scout_trigger(db: Database, workspace_id: string, agent_id: string) {
  const rows = await db.query.triggers.findMany({
    where: (table, { and, eq }) =>
      and(eq(table.workspace_id, workspace_id), eq(table.agent_id, agent_id)),
  });
  return rows.find(is_workspace_scout_trigger) ?? null;
}

async function update_scout_config(db: Database, trigger: TriggerRow, timezone: string) {
  const config = trigger.trigger_config;
  if (config[scout_config_key]?.mode === scout_mode && config.timezone === timezone) return trigger;

  const [updated] = await db
    .update(triggers_table)
    .set({
      trigger_config: build_scout_trigger_config(timezone),
      last_updated_time: new Date(),
      last_updated_by: scout_provisioning_actor,
    })
    .where(eq(triggers_table.trigger_id, trigger.trigger_id))
    .returning();
  return updated ?? trigger;
}

function build_scout_trigger_config(timezone: string): TriggerConfigData {
  return {
    starts_job_handler: scout_job_handler,
    timezone,
    provisioning_key: scout_provisioning_key,
    [scout_config_key]: {
      version: 1,
      mode: scout_mode,
      max_output_tokens: 1600,
      recent_message_limit: 30,
      max_actions: 3,
    },
  };
}

function is_workspace_scout_trigger(trigger: TriggerRow) {
  const config = trigger.trigger_config;
  return (
    trigger.trigger_type === 'schedule' &&
    config?.starts_job_handler === scout_job_handler &&
    config?.provisioning_key === scout_provisioning_key &&
    config[scout_config_key]?.version === 1
  );
}
