import { read_wire_account_id } from '@api/services/automations/app_event_trigger_plan';
import {
  account_gone_code,
  choose_trigger_account,
  gathering_of_the_signer_alone,
} from '@api/services/automations/trigger_account_choice';
import { remove_trigger, reprovision_trigger_schedule } from '@api/services/scheduling';
import { get_trigger_wire_provisioner } from '@api/services/triggers/trigger_wire';
import type { Database, DatabaseExecutor } from '@coworker/core';
import { get_tool_catalog_entry } from '@coworker/core/db/queries/catalog';
import { update_trigger } from '@coworker/core/db/queries/trigger_writes';
import { AppError, create_logger, format_error_message, ValidationError } from '@coworker/shared';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { plain_provider_error } from '@runtime-platform/triggers/provider_error_words';

const log = create_logger('automation_trigger_wiring');

export async function provision_automation_trigger(
  db: Database,
  trigger: TriggerRow,
  connected_account_id: string | null,
): Promise<TriggerRow> {
  try {
    if (trigger.trigger_type === 'schedule') {
      await reprovision_trigger_schedule(trigger);
      return trigger;
    }
    if (trigger.trigger_type !== 'app_event') return trigger;
    return await create_event_wire(db, trigger, connected_account_id);
  } catch (error) {
    const reason = format_error_message(error);
    log.error('automation trigger provisioning failed', { trigger_id: trigger.trigger_id, reason });
    return update_trigger(db, {
      workspace_id: trigger.workspace_id,
      trigger_id: trigger.trigger_id,
      trigger_status: 'error',
      trigger_config: {
        ...trigger.trigger_config,
        provisioning_error: plain_provider_error(reason),
      },
      actor_id: trigger.last_updated_by,
    });
  }
}

async function create_event_wire(
  db: Database,
  trigger: TriggerRow,
  connected_account_id: string | null,
): Promise<TriggerRow> {
  const event_source = trigger.trigger_config.event_source;
  const provisioned_by = trigger.trigger_config.provisioned_by;
  const needs_connection = trigger.trigger_config.needs_connection;
  if (!event_source || !provisioned_by) return trigger;
  if (needs_connection) {
    throw new ValidationError(`needs ${needs_connection} connected`);
  }
  if (!connected_account_id) throw new ValidationError('connection is no longer active');
  if (!event_source.trigger_slug) throw new ValidationError('trigger has no provider event');
  const wire = await get_trigger_wire_provisioner(provisioned_by).create({
    db,
    workspace_id: trigger.workspace_id,
    trigger_id: trigger.trigger_id,
    connection_id: event_source.connection_id,
    trigger_slug: event_source.trigger_slug,
    connected_account_id,
    subscription_config: event_source.subscription_config ?? {},
  });
  return update_trigger(db, {
    workspace_id: trigger.workspace_id,
    trigger_id: trigger.trigger_id,
    trigger_config: {
      ...trigger.trigger_config,
      ...wire.trigger_config,
      provisioning_key: wire.provisioning_key,
    },
    actor_id: trigger.last_updated_by,
  });
}

export type TriggerToWire = { trigger: TriggerRow; connected_account_id: string | null };

export async function reopen_trigger_for_wiring(
  db: DatabaseExecutor,
  trigger: TriggerRow,
  actor_id: string,
): Promise<TriggerToWire> {
  const unchanged = { trigger, connected_account_id: null };
  const event_source = trigger.trigger_config.event_source;
  if (!event_source || trigger.trigger_config.provisioning_key) return unchanged;
  const node = await get_tool_catalog_entry(db, {
    workspace_id: trigger.workspace_id,
    node_key: event_source.node_key,
  });
  if (!node) return unchanged;
  try {
    const connection = await choose_trigger_account(db, {
      workspace_id: trigger.workspace_id,
      app_id: node.app_id,
      connection_id: event_source.connection_id,
      gathering: gathering_of_the_signer_alone(actor_id),
    });
    const connected_account_id = connection ? read_wire_account_id(connection) : null;
    if (!connection || !connected_account_id) {
      const waiting_for = `needs ${node.app_display_name} connected`;
      return refuse_wiring(db, trigger, actor_id, waiting_for, node.app_display_name);
    }
    const listening_on = { ...event_source, connection_id: connection.connection_id };
    return {
      trigger: await reopen_trigger(db, trigger, actor_id, listening_on),
      connected_account_id,
    };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const gone = error.code === account_gone_code ? node.app_display_name : undefined;
    return refuse_wiring(db, trigger, actor_id, error.message, gone);
  }
}

function reopen_trigger(
  db: DatabaseExecutor,
  trigger: TriggerRow,
  actor_id: string,
  event_source: NonNullable<TriggerRow['trigger_config']['event_source']>,
) {
  const { needs_connection, provisioning_error, ...kept } = trigger.trigger_config;
  return update_trigger(db, {
    workspace_id: trigger.workspace_id,
    trigger_id: trigger.trigger_id,
    trigger_status: 'enabled',
    trigger_config: { ...kept, event_source },
    actor_id,
  });
}

async function refuse_wiring(
  db: DatabaseExecutor,
  trigger: TriggerRow,
  actor_id: string,
  reason: string,
  needs_connection: string | undefined,
): Promise<TriggerToWire> {
  log.info('an ear was not wired again', { trigger_id: trigger.trigger_id, reason });
  const refused = await update_trigger(db, {
    workspace_id: trigger.workspace_id,
    trigger_id: trigger.trigger_id,
    trigger_status: 'error',
    trigger_config: {
      ...trigger.trigger_config,
      ...(needs_connection ? { needs_connection } : {}),
      provisioning_error: reason,
    },
    actor_id,
  });
  return { trigger: refused, connected_account_id: null };
}

export function wire_reopened_trigger(db: Database, reopened: TriggerToWire) {
  if (!reopened.connected_account_id) return reopened.trigger;
  return provision_automation_trigger(db, reopened.trigger, reopened.connected_account_id);
}

export async function delete_automation_trigger(
  db: Database,
  input: { workspace_id: string; trigger_id: string },
) {
  return remove_trigger(db, input);
}
