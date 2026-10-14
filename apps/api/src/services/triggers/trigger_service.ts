import { remove_trigger, schedule_new_trigger, set_trigger_status } from '@api/services/scheduling';
import { get_cron_schedule } from '@api/services/scheduling/cron_schedule';
import { keep_server_owned_config_keys } from '@api/services/triggers/trigger_config_ownership';
import { update_trigger_after_edit } from '@api/services/triggers/update_trigger_after_edit';
import { resolve_workspace_timezone } from '@api/services/triggers/workspace_timezone';
import {
  add_schedule_jitter,
  type Database,
  type DatabaseExecutor,
  find_workspace_plan,
  set_scheduled_task_authority,
} from '@coworker/core';
import { set_session_read_marker } from '@coworker/core/db/queries/session_read_markers';
import {
  count_enabled_user_schedules,
  get_trigger_by_id,
  list_agent_triggers,
  list_triggers,
  list_workspace_schedule_triggers,
  lock_workspace_trigger_changes,
} from '@coworker/core/db/queries/trigger_reads';
import { count_trigger_runs } from '@coworker/core/db/queries/trigger_run_counts';
import {
  list_trigger_run_page,
  list_trigger_run_read_positions,
} from '@coworker/core/db/queries/trigger_runs';
import {
  type CreateTriggerInput,
  create_trigger,
  delete_trigger_row,
  type TriggerStatus,
  type UpdateTriggerInput,
} from '@coworker/core/db/queries/trigger_writes';
import { read_user_timezone } from '@coworker/core/db/queries/user_timezone';
import type { TriggerConfigData } from '@coworker/core/db/schema/json_column_types';
import { agent_heartbeat_job_handler, NotFoundError, ValidationError } from '@coworker/shared';
import { read_trigger_schedule, type TriggerRow } from '@runtime-platform/events/trigger_ingress';

export { resolve_workspace_timezone };

export const agent_tool_trigger_source = 'agent_tool';
export const scheduled_agent_task_handler = 'run_scheduled_agent_task';
export const agent_created_scheduled_task_cap = 10;
const legacy_live_trigger_statuses = new Set<string>(['enabled', 'disabled', 'error']);
const live_status = 'enabled';

export type CreateAgentScheduledTaskInput = {
  workspace_id: string;
  agent_id: string;
  task_name: string;
  instruction: string;
  context_digest?: string | undefined;
  schedule_expression?: string | null;
  run_once_at?: string | undefined;
  timezone?: string | undefined;
  source_metadata?: Record<string, unknown>;
  actor_id: string;
};

export type UpdateAgentScheduledTaskInput = {
  workspace_id: string;
  agent_id: string;
  trigger_id: string;
  task_name?: string;
  instruction?: string;
  context_digest?: string | undefined;
  trigger_status?: TriggerStatus;
  schedule_expression?: string | null;
  run_once_at?: string | undefined;
  timezone?: string | undefined;
  actor_id: string;
};

export async function list_workspace_triggers(db: Database, workspace_id: string) {
  const triggers = await list_triggers(db, workspace_id);
  const visible_triggers = triggers.filter(user_may_manage_trigger);
  const run_counts = await count_trigger_runs(db, {
    workspace_id,
    trigger_ids: visible_triggers.map((trigger) => trigger.trigger_id),
  });
  return visible_triggers.map((trigger) => ({
    ...trigger,
    run_count: run_counts.get(trigger.trigger_id) ?? 0,
  }));
}

export async function list_workspace_trigger_runs(
  db: Database,
  input: {
    workspace_id: string;
    trigger_id: string;
    reader_id: string;
    page: number;
    page_size: number;
  },
) {
  const trigger = await get_workspace_trigger(db, input.workspace_id, input.trigger_id);
  reject_system_managed_trigger(trigger);
  return list_trigger_run_page(db, input);
}

export async function mark_workspace_trigger_runs_read(
  db: Database,
  input: { workspace_id: string; trigger_id: string; reader_id: string },
) {
  const trigger = await get_workspace_trigger(db, input.workspace_id, input.trigger_id);
  reject_system_managed_trigger(trigger);
  const positions = await list_trigger_run_read_positions(db, input);
  await Promise.all(
    positions.map((position) =>
      set_session_read_marker(db, {
        workspace_id: input.workspace_id,
        session_id: position.session_id,
        reader_id: input.reader_id,
        last_read_sequence: position.newest_sequence,
      }),
    ),
  );
  return { marked_session_count: positions.length };
}

export async function list_agent_scheduled_tasks(
  db: Database,
  input: { workspace_id: string; agent_id: string },
) {
  const triggers = await list_agent_triggers(db, input);
  return triggers.filter((trigger) => is_agent_scheduled_task(trigger, input.agent_id));
}

export async function create_agent_scheduled_task(
  db: Database,
  input: CreateAgentScheduledTaskInput,
) {
  const timezone =
    input.timezone ??
    (await read_user_timezone(db, input.actor_id)) ??
    (await resolve_workspace_timezone(db, input.workspace_id));
  return create_workspace_trigger(db, {
    trigger_status: 'enabled',
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    trigger_name: input.task_name,
    trigger_type: 'schedule',
    trigger_config: build_scheduled_task_config({ ...input, timezone }),
    trigger_source: {
      ...(input.source_metadata ?? {}),
      origin: agent_tool_trigger_source,
    },
    ...(input.schedule_expression === undefined
      ? {}
      : { schedule_expression: input.schedule_expression }),
    actor_id: input.actor_id,
  });
}

export async function update_agent_scheduled_task(
  db: Database,
  input: UpdateAgentScheduledTaskInput,
) {
  return db.transaction(async (transaction) => {
    await lock_workspace_trigger_changes(transaction, input.workspace_id);
    const current_trigger = await get_agent_scheduled_task(transaction, input);
    return update_trigger_from_current(transaction, current_trigger, {
      workspace_id: input.workspace_id,
      trigger_id: input.trigger_id,
      ...(input.task_name === undefined ? {} : { trigger_name: input.task_name }),
      ...(input.trigger_status === undefined ? {} : { trigger_status: input.trigger_status }),
      ...(input.schedule_expression === undefined
        ? {}
        : { schedule_expression: input.schedule_expression }),
      ...(scheduled_task_config_needs_update(input)
        ? { trigger_config: build_updated_scheduled_task_config(current_trigger, input) }
        : {}),
      actor_id: input.actor_id,
    });
  });
}

export async function delete_agent_scheduled_task(
  db: Database,
  input: { workspace_id: string; agent_id: string; trigger_id: string },
) {
  const trigger = await get_agent_scheduled_task(db, input);
  if (read_trigger_schedule(trigger)) {
    await (await get_cron_schedule()).delete_schedule(trigger.trigger_id);
  }
  const deleted = await delete_trigger_row(db, {
    workspace_id: input.workspace_id,
    trigger_id: input.trigger_id,
  });
  if (!deleted) throw new NotFoundError('Scheduled task');
  return deleted;
}

export async function create_workspace_trigger(db: Database, input: CreateTriggerInput) {
  const authorized_input = set_trigger_instruction_authority(spread_user_schedule(input));
  return db.transaction(async (transaction) => {
    await lock_workspace_trigger_changes(transaction, input.workspace_id);
    await reject_schedule_above_plan_limit(transaction, authorized_input, true);
    const trigger = await create_trigger(transaction, authorized_input);
    if (trigger.trigger_status === live_status) await schedule_new_trigger(transaction, trigger);
    return trigger;
  });
}

export async function update_workspace_trigger(
  db: Database,
  input: UpdateTriggerInput,
): Promise<TriggerRow> {
  return db.transaction(async (transaction) => {
    await lock_workspace_trigger_changes(transaction, input.workspace_id);
    const current_trigger = await get_workspace_trigger(
      transaction,
      input.workspace_id,
      input.trigger_id,
    );
    reject_system_managed_trigger(current_trigger);
    const owned_input =
      input.trigger_config === undefined
        ? input
        : {
            ...input,
            trigger_config: keep_server_owned_config_keys(
              current_trigger.trigger_config,
              input.trigger_config,
            ),
          };
    return update_trigger_from_current(transaction, current_trigger, owned_input);
  });
}

async function update_trigger_from_current(
  db: DatabaseExecutor,
  current_trigger: TriggerRow,
  input: UpdateTriggerInput,
): Promise<TriggerRow> {
  const target_input =
    input.agent_id !== undefined && input.trigger_target === undefined
      ? { ...input, trigger_target: { kind: 'agent_run', agent_id: input.agent_id } }
      : input;
  const authorized_input = set_updated_trigger_instruction_authority(current_trigger, target_input);
  const next_trigger = build_next_trigger(current_trigger, authorized_input);

  if (current_trigger.trigger_status !== live_status) {
    await reject_schedule_above_plan_limit(db, next_trigger);
  }

  await set_schedule_for_next_trigger(current_trigger, next_trigger);

  return update_trigger_after_edit(db, current_trigger, next_trigger, authorized_input);
}

export async function set_workspace_trigger_status(
  db: Database,
  input: {
    workspace_id: string;
    trigger_id: string;
    trigger_status: TriggerStatus;
    actor_id: string;
  },
) {
  return db.transaction(async (transaction) => {
    await lock_workspace_trigger_changes(transaction, input.workspace_id);
    const trigger = await get_workspace_trigger(transaction, input.workspace_id, input.trigger_id);
    reject_system_managed_trigger(trigger);
    if (trigger.trigger_status !== live_status) {
      await reject_schedule_above_plan_limit(transaction, {
        ...trigger,
        trigger_status: input.trigger_status,
      });
    }
    return set_trigger_status(transaction, input);
  });
}

export async function delete_workspace_trigger(
  db: Database,
  input: { workspace_id: string; trigger_id: string },
) {
  const trigger = await get_workspace_trigger(db, input.workspace_id, input.trigger_id);
  reject_system_managed_trigger(trigger);
  return remove_trigger(db, input);
}

export async function get_workspace_trigger(
  db: DatabaseExecutor,
  workspace_id: string,
  trigger_id: string,
) {
  const trigger = await get_trigger_by_id(db, trigger_id);
  if (!trigger || trigger.workspace_id !== workspace_id) throw new NotFoundError('Trigger');
  return trigger;
}

async function get_agent_scheduled_task(
  db: DatabaseExecutor,
  input: { workspace_id: string; agent_id: string; trigger_id: string },
) {
  const trigger = await get_trigger_by_id(db, input.trigger_id);
  if (
    trigger?.workspace_id !== input.workspace_id ||
    !is_agent_scheduled_task(trigger, input.agent_id)
  ) {
    throw new NotFoundError('Scheduled task');
  }
  return trigger;
}

function build_next_trigger(trigger: TriggerRow, input: UpdateTriggerInput): TriggerRow {
  return {
    ...trigger,
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
  };
}

async function set_schedule_for_next_trigger(
  current_trigger: TriggerRow,
  next_trigger: TriggerRow,
) {
  const current_schedule = read_trigger_schedule(current_trigger);
  const next_schedule = read_trigger_schedule(next_trigger);
  if (!current_schedule && !next_schedule) return;

  const cron_schedule = await get_cron_schedule();
  if (next_schedule?.run_once_at && !cron_schedule.supports_run_once) {
    throw new ValidationError(
      'One-time tasks are not supported by the current scheduling backend.',
    );
  }

  if (next_trigger.trigger_status === live_status) {
    if (next_schedule) {
      await cron_schedule.set_schedule(next_schedule);
      return;
    }
    if (current_schedule) await cron_schedule.delete_schedule(current_trigger.trigger_id);
    return;
  }

  if (current_schedule) await cron_schedule.pause_schedule(current_trigger.trigger_id);
}

function spread_user_schedule(input: CreateTriggerInput): CreateTriggerInput {
  if (!input.schedule_expression || input.trigger_config?.run_once_at) return input;
  return {
    ...input,
    schedule_expression: add_schedule_jitter({
      cron_expression: input.schedule_expression,
      workspace_id: input.workspace_id,
      window: 'small_window',
    }),
  };
}

async function reject_schedule_above_plan_limit(
  db: DatabaseExecutor,
  trigger: CreateTriggerInput | TriggerRow,
  preserve_legacy_creation_cap = false,
) {
  const plan = await find_workspace_plan(db, trigger.workspace_id);
  if (!plan || plan.plan_key === 'enterprise') {
    return preserve_legacy_creation_cap
      ? reject_legacy_agent_task_above_limit(db, trigger)
      : undefined;
  }
  if (
    trigger.trigger_type !== 'schedule' ||
    (trigger.trigger_status ?? live_status) !== live_status
  ) {
    return;
  }
  if (trigger.trigger_config?.starts_job_handler === agent_heartbeat_job_handler) return;

  if (plan.scheduled_task_limit === null) return;
  if ((await count_enabled_user_schedules(db, trigger.workspace_id)) < plan.scheduled_task_limit) {
    return;
  }

  throw new ValidationError(
    `This workspace plan supports at most ${plan.scheduled_task_limit} active scheduled tasks.`,
    { limit: plan.scheduled_task_limit },
  );
}

async function reject_legacy_agent_task_above_limit(
  db: DatabaseExecutor,
  trigger: CreateTriggerInput | TriggerRow,
) {
  if (trigger.trigger_type !== 'schedule') return;
  if (trigger.trigger_source?.origin !== agent_tool_trigger_source) return;
  if (trigger.trigger_config?.starts_job_handler !== scheduled_agent_task_handler) return;

  const workspace_triggers = await list_workspace_schedule_triggers(db, trigger.workspace_id);
  const task_count = workspace_triggers.filter(
    (candidate) =>
      legacy_live_trigger_statuses.has(candidate.trigger_status) &&
      candidate.trigger_source.origin === agent_tool_trigger_source &&
      candidate.trigger_config.starts_job_handler === scheduled_agent_task_handler,
  ).length;
  if (task_count < agent_created_scheduled_task_cap) return;

  throw new ValidationError(
    `A workspace can have at most ${agent_created_scheduled_task_cap} live agent-created scheduled tasks.`,
    { cap: agent_created_scheduled_task_cap },
  );
}

function is_agent_scheduled_task(trigger: TriggerRow, agent_id: string) {
  return (
    trigger.agent_id === agent_id &&
    trigger.trigger_type === 'schedule' &&
    trigger.trigger_config.starts_job_handler === scheduled_agent_task_handler
  );
}

function user_may_manage_trigger(trigger: TriggerRow) {
  return trigger.trigger_config.starts_job_handler !== agent_heartbeat_job_handler;
}

export function reject_system_managed_trigger(trigger: TriggerRow) {
  if (!user_may_manage_trigger(trigger)) throw new NotFoundError('Trigger');
}

function build_scheduled_task_config(input: {
  instruction: string;
  context_digest?: string | undefined;
  timezone?: string | undefined;
  run_once_at?: string | undefined;
}) {
  return {
    starts_job_handler: scheduled_agent_task_handler,
    ...(input.timezone ? { timezone: input.timezone } : {}),
    ...(input.run_once_at ? { run_once_at: input.run_once_at } : {}),
    job_input: {
      instruction: input.instruction,
      ...(input.context_digest ? { context_digest: input.context_digest } : {}),
    },
  };
}

function build_updated_scheduled_task_config(
  current_trigger: TriggerRow,
  input: UpdateAgentScheduledTaskInput,
) {
  const current_config = current_trigger.trigger_config;
  return build_scheduled_task_config({
    instruction: input.instruction ?? current_config.job_input?.instruction ?? '',
    context_digest: input.context_digest ?? current_config.job_input?.context_digest,
    run_once_at: input.run_once_at ?? current_config.run_once_at,
    timezone: input.timezone ?? current_config.timezone,
  });
}

function scheduled_task_config_needs_update(input: UpdateAgentScheduledTaskInput) {
  return (
    input.instruction !== undefined ||
    input.context_digest !== undefined ||
    input.timezone !== undefined ||
    input.run_once_at !== undefined
  );
}

function set_trigger_instruction_authority(input: CreateTriggerInput): CreateTriggerInput {
  const instruction = scheduled_task_instruction(input.trigger_config ?? {});
  if (!instruction) return input;
  return {
    ...input,
    trigger_source: set_scheduled_task_authority(input.trigger_source, input.actor_id, instruction),
  };
}

function set_updated_trigger_instruction_authority(
  current_trigger: TriggerRow,
  input: UpdateTriggerInput,
): UpdateTriggerInput {
  const current_instruction = scheduled_task_instruction(current_trigger.trigger_config);
  const next_instruction = scheduled_task_instruction(
    input.trigger_config ?? current_trigger.trigger_config,
  );
  if (!next_instruction || next_instruction === current_instruction) return input;
  return {
    ...input,
    trigger_source: set_scheduled_task_authority(
      input.trigger_source ?? current_trigger.trigger_source,
      input.actor_id,
      next_instruction,
    ),
  };
}

function scheduled_task_instruction(config: TriggerConfigData) {
  if (config.starts_job_handler !== scheduled_agent_task_handler) return null;
  return config.job_input?.instruction ?? null;
}
