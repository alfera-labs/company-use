import { get_cron_schedule } from '@api/services/scheduling/cron_schedule';
import {
  set_wire_enabled,
  wire_is_already_gone,
  wire_is_still_wanted,
} from '@api/services/scheduling/trigger_wire_switch';
import {
  get_trigger_wire_provisioner,
  read_trigger_wire,
} from '@api/services/triggers/trigger_wire';
import type { Database, DatabaseExecutor } from '@coworker/core';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import {
  delete_trigger_row,
  type TriggerStatus,
  update_trigger,
  update_trigger_status,
} from '@coworker/core/db/queries/trigger_writes';
import { read_trigger_schedule, type TriggerRow } from '@coworker/runtime-platform';
import { create_logger, NotFoundError, ValidationError } from '@coworker/shared';
import { plain_provider_error } from '@runtime-platform/triggers/provider_error_words';

const log = create_logger('schedule_new_trigger');

const live_status = 'enabled';

export async function schedule_new_trigger(db: DatabaseExecutor, trigger: TriggerRow) {
  const schedule = read_trigger_schedule(trigger);
  if (!schedule) return;
  const cron_schedule = await get_cron_schedule();
  if (schedule.run_once_at && !cron_schedule.supports_run_once) {
    await delete_trigger_row(db, {
      workspace_id: trigger.workspace_id,
      trigger_id: trigger.trigger_id,
    }).catch((cleanup_error) => {
      log.error('rollback delete failed', cleanup_error);
    });
    throw new ValidationError(
      'One-time tasks are not supported by the current scheduling backend.',
    );
  }
  try {
    await cron_schedule.set_schedule(schedule);
  } catch (error) {
    await delete_trigger_row(db, {
      workspace_id: trigger.workspace_id,
      trigger_id: trigger.trigger_id,
    }).catch((cleanup_error) => {
      log.error('rollback delete failed', cleanup_error);
    });
    throw error;
  }
}

export async function set_trigger_status(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    trigger_id: string;
    trigger_status: TriggerStatus;
    actor_id: string;
  },
): Promise<TriggerRow> {
  const trigger = await get_trigger_by_id(db, input.trigger_id);
  if (!trigger || trigger.workspace_id !== input.workspace_id) throw new NotFoundError('Trigger');

  const schedule = read_trigger_schedule(trigger);
  if (schedule) {
    const cron_schedule = await get_cron_schedule();
    if (input.trigger_status === live_status) {
      await cron_schedule.set_schedule(schedule);
    } else {
      await cron_schedule.pause_schedule(trigger.trigger_id);
    }
  }

  const wire = read_trigger_wire(trigger);
  const enabling = input.trigger_status === live_status;
  const wire_is_shared =
    !!wire && !enabling && (await wire_is_still_wanted(db, trigger.trigger_id, wire));
  const gone = wire && !wire_is_shared ? await set_wire_enabled(wire, enabling) : null;

  if (!gone) return update_trigger_status(db, input);
  return update_trigger(db, {
    workspace_id: input.workspace_id,
    trigger_id: input.trigger_id,
    trigger_status: input.trigger_status,
    trigger_config: { ...trigger.trigger_config, provisioning_error: plain_provider_error(gone) },
    actor_id: input.actor_id,
  });
}

export async function reprovision_trigger_schedule(trigger: TriggerRow) {
  if (trigger.trigger_status !== live_status) return;
  const schedule = read_trigger_schedule(trigger);
  if (!schedule || schedule.run_once_at) return;
  await (await get_cron_schedule()).set_schedule(schedule);
}

export async function remove_trigger(
  db: Database,
  input: { workspace_id: string; trigger_id: string },
): Promise<TriggerRow | null> {
  const trigger = await get_trigger_by_id(db, input.trigger_id);
  if (!trigger || trigger.workspace_id !== input.workspace_id) return null;

  if (read_trigger_schedule(trigger)) {
    await (await get_cron_schedule()).delete_schedule(trigger.trigger_id);
  }
  const wire = read_trigger_wire(trigger);
  if (wire && !(await wire_is_still_wanted(db, trigger.trigger_id, wire))) {
    await get_trigger_wire_provisioner(wire.provisioned_by)
      .delete({
        db,
        workspace_id: trigger.workspace_id,
        trigger_id: trigger.trigger_id,
        connection_id: trigger.trigger_config.event_source?.connection_id,
        provisioning_key: wire.provisioning_key,
      })
      .catch((error: unknown) => {
        if (!wire_is_already_gone(error)) throw error;
        log.warn('trigger wire was already gone', { provisioning_key: wire.provisioning_key });
      });
  }
  return delete_trigger_row(db, input);
}
