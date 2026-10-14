import type { Database } from '@coworker/core';
import { get_workspace_connection_for_connector } from '@coworker/core/db/queries/connectors';
import { list_triggers_by_provisioning_key } from '@coworker/core/db/queries/trigger_provisioning';
import { type ComposioWebhookEvent, read_connected_account_id } from '@coworker/runtime-platform';
import { create_logger } from '@coworker/shared';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { is_native_trigger_node_key } from '@runtime-platform/tools/native_trigger_seed';

const log = create_logger('trigger_deliveries');

/**
 * Every trigger this delivery belongs to. Plural on purpose: Composio upserts ONE instance per
 * (account, event), so two automations listening to the same mailbox share one provisioning key and
 * one delivery is meant for both of them. Each one gets its own event (`source_event_id` is
 * `{trigger_id}:{webhook_id}`), so dedup stays per trigger and a retried delivery still collapses.
 * The refusal reasons stay single-valued: nothing heard it, nothing enabled heard it, or nothing
 * whose own connection matches the account heard it.
 */
export async function find_listening_triggers(
  db: Database,
  envelope: ComposioWebhookEvent,
  webhook_id: string,
): Promise<{ triggers: TriggerRow[] } | { reason: string }> {
  const provisioning_key = envelope.metadata.trigger_id;
  const owners = provisioning_key
    ? await list_triggers_by_provisioning_key(db, { provisioned_by: 'composio', provisioning_key })
    : [];
  if (owners.length === 0) return { reason: 'no_trigger' };
  const enabled = owners.filter((trigger) => trigger.trigger_status === 'enabled');
  if (enabled.length === 0) return { reason: 'trigger_disabled' };

  const matches = await Promise.all(
    enabled.map((trigger) => delivery_is_for_this_trigger_connection(db, trigger, envelope)),
  );
  const triggers = enabled.filter((_trigger, index) => matches[index]);
  for (const trigger of enabled.filter((_trigger, index) => !matches[index])) {
    log.warn('Refused a Composio delivery whose account or app is not the one this trigger reads', {
      webhook_id,
      trigger_id: trigger.trigger_id,
      workspace_id: trigger.workspace_id,
      connected_account_id: envelope.metadata.connected_account_id,
      trigger_slug: envelope.metadata.trigger_slug,
    });
  }
  if (triggers.length === 0) return { reason: 'account_mismatch' };
  return { triggers };
}

async function delivery_is_for_this_trigger_connection(
  db: Database,
  trigger: TriggerRow,
  envelope: ComposioWebhookEvent,
) {
  const connection_id = trigger.trigger_config.event_source?.connection_id;
  if (!connection_id)
    return is_native_trigger_node_key(trigger.trigger_config.event_source?.node_key);

  const connection = await get_workspace_connection_for_connector(db, {
    workspace_id: trigger.workspace_id,
    connection_id,
  });
  if (!connection) return false;
  const our_account_id = read_connected_account_id(connection);
  if (!our_account_id || our_account_id !== envelope.metadata.connected_account_id) return false;
  return connection_is_for_toolkit(connection, read_delivery_toolkit(envelope));
}

function read_delivery_toolkit(envelope: ComposioWebhookEvent) {
  return (envelope.metadata.trigger_slug ?? '').split('_')[0]?.toLowerCase() ?? '';
}

function connection_is_for_toolkit(
  connection: {
    provider_account?: { toolkit_slug?: string } | null;
    provider_config_key?: string | null;
    connection_key?: string | null;
  },
  toolkit: string,
) {
  if (!toolkit) return false;
  const names = [
    connection.provider_account?.toolkit_slug,
    connection.provider_config_key?.split(':').at(-1),
    connection.connection_key?.replace(/^composio_/u, ''),
  ];
  return names.some((name) => name?.toLowerCase() === toolkit);
}
