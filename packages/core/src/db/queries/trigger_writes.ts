import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { triggers } from '@coworker/core/db/schema';
import type {
  TriggerConfigData,
  TriggerSourceData,
} from '@coworker/core/db/schema/json_column_types';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq } from 'drizzle-orm';

type TriggerType = 'schedule' | 'webhook' | 'app_event' | 'manual' | 'system_event';

export type TriggerStatus = 'enabled' | 'disabled' | 'error' | 'completed';

export type CreateTriggerInput = {
  workspace_id: string;
  agent_id: string;
  node_id?: string | null;
  automation_id?: string | null;
  trigger_name: string;
  trigger_type: TriggerType;
  trigger_status?: TriggerStatus | undefined;
  trigger_config?: TriggerConfigData;
  trigger_source?: TriggerSourceData;
  trigger_target?: Record<string, unknown>;
  schedule_expression?: string | null;
  actor_id: string;
};

export type UpdateTriggerInput = {
  workspace_id: string;
  trigger_id: string;
  trigger_name?: string;
  trigger_status?: TriggerStatus;
  agent_id?: string;
  trigger_type?: TriggerType;
  trigger_config?: TriggerConfigData;
  trigger_source?: TriggerSourceData;
  trigger_target?: Record<string, unknown>;
  schedule_expression?: string | null;
  next_run_time?: null;
  actor_id: string;
};

export async function create_trigger(db: DatabaseExecutor, input: CreateTriggerInput) {
  const [trigger] = await db
    .insert(triggers)
    .values({
      trigger_id: create_id(id_prefixes.trigger),
      workspace_id: input.workspace_id,
      agent_id: input.agent_id,
      node_id: input.node_id ?? null,
      automation_id: input.automation_id ?? null,
      trigger_name: input.trigger_name,
      trigger_type: input.trigger_type,
      trigger_status: input.trigger_status ?? 'enabled',
      trigger_config: input.trigger_config ?? {},
      trigger_source: input.trigger_source ?? {},
      trigger_target: input.trigger_target ?? build_default_trigger_target(input),
      schedule_expression: input.schedule_expression ?? null,
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  return require_inserted_row(trigger, 'Trigger');
}

function build_default_trigger_target(input: CreateTriggerInput) {
  if (input.node_id) return { kind: 'node_run', node_id: input.node_id };
  return { kind: 'agent_run', agent_id: input.agent_id };
}

export async function update_trigger_status(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    trigger_id: string;
    trigger_status: TriggerStatus;
    actor_id: string;
  },
) {
  const [trigger] = await db
    .update(triggers)
    .set({
      trigger_status: input.trigger_status,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(eq(triggers.workspace_id, input.workspace_id), eq(triggers.trigger_id, input.trigger_id)),
    )
    .returning();

  return require_inserted_row(trigger, 'Trigger');
}

export async function update_trigger(db: DatabaseExecutor, input: UpdateTriggerInput) {
  const [trigger] = await db
    .update(triggers)
    .set({
      ...(input.trigger_name === undefined ? {} : { trigger_name: input.trigger_name }),
      ...(input.trigger_status === undefined ? {} : { trigger_status: input.trigger_status }),
      ...(input.agent_id === undefined ? {} : { agent_id: input.agent_id }),
      ...(input.trigger_type === undefined ? {} : { trigger_type: input.trigger_type }),
      ...(input.trigger_config === undefined ? {} : { trigger_config: input.trigger_config }),
      ...(input.trigger_source === undefined ? {} : { trigger_source: input.trigger_source }),
      ...(input.trigger_target === undefined ? {} : { trigger_target: input.trigger_target }),
      ...(input.schedule_expression === undefined
        ? {}
        : { schedule_expression: input.schedule_expression }),
      ...(input.next_run_time === undefined ? {} : { next_run_time: input.next_run_time }),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(eq(triggers.workspace_id, input.workspace_id), eq(triggers.trigger_id, input.trigger_id)),
    )
    .returning();

  return require_inserted_row(trigger, 'Trigger');
}

/**
 * Marks a one-time trigger terminal after it has fired. The external schedule has already removed
 * itself (AWS one-time schedules self-delete), so this only settles the DB row: 'completed' is not
 * live, so it never re-fires, and the UI shows it as done. Keyed by trigger_id alone because the
 * event-job handler that fires the task has no workspace context.
 */
export async function mark_trigger_completed(db: Database, trigger_id: string) {
  const [trigger] = await db
    .update(triggers)
    .set({ trigger_status: 'completed', last_updated_time: new Date(), last_updated_by: 'system' })
    .where(eq(triggers.trigger_id, trigger_id))
    .returning();

  return trigger ?? null;
}

export async function delete_trigger_row(
  db: DatabaseExecutor,
  input: { workspace_id: string; trigger_id: string },
) {
  const [trigger] = await db
    .delete(triggers)
    .where(
      and(eq(triggers.workspace_id, input.workspace_id), eq(triggers.trigger_id, input.trigger_id)),
    )
    .returning();

  return trigger ?? null;
}
