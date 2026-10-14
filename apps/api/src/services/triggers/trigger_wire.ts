import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { get_workspace_connection_for_connector } from '@coworker/core/db/queries/connectors';
import { AppError, create_logger, ValidationError } from '@coworker/shared';
import {
  type ComposioAccount,
  create_attio_webhook,
  delete_attio_webhook,
  read_attio_object_id,
} from '@runtime-platform/attio/attio_webhook_setup';
import { read_connected_account_id } from '@runtime-platform/composio/composio_connect';
import {
  create_composio_trigger_instance,
  delete_composio_trigger_instance,
  set_composio_trigger_instance_enabled,
} from '@runtime-platform/composio/composio_triggers';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';

const log = create_logger('trigger_wire');

type TriggerWireOwner = {
  db: Database;
  workspace_id: string;
  trigger_id: string;
  connection_id: string | undefined;
};

export type TriggerWireProvisioner = {
  create(
    input: TriggerWireOwner & {
      trigger_slug: string;
      connected_account_id: string;
      subscription_config: Record<string, unknown>;
    },
  ): Promise<{ provisioning_key: string; trigger_config?: Record<string, unknown> }>;
  set_enabled(input: { provisioning_key: string; enabled: boolean }): Promise<void>;
  delete(input: TriggerWireOwner & { provisioning_key: string }): Promise<void>;
};

export const trigger_wire_provisioners: Record<'composio' | 'attio', TriggerWireProvisioner> = {
  composio: {
    async create(input) {
      const wire = await create_composio_trigger_instance({
        trigger_slug: input.trigger_slug,
        connected_account_id: input.connected_account_id,
        trigger_config: input.subscription_config,
      });
      return { provisioning_key: wire.trigger_id };
    },
    async set_enabled(input) {
      await set_composio_trigger_instance_enabled({
        trigger_id: input.provisioning_key,
        enabled: input.enabled,
      });
    },
    async delete(input) {
      await delete_composio_trigger_instance({ trigger_id: input.provisioning_key });
    },
  },
  attio: {
    async create(input) {
      const account = await read_attio_composio_account(input);
      const object = input.subscription_config.object;
      // The person picks an object by slug ("companies"); Attio's deliveries name object ids, so
      // the slug becomes an id here, once, and is kept for the delivery route.
      const object_id =
        typeof object === 'string' && object.trim()
          ? await read_attio_object_id(account, object.trim())
          : undefined;
      const webhook = await create_attio_webhook(account, {
        target_url: attio_delivery_url(input.trigger_id),
        event_type: input.trigger_slug,
      });
      return {
        provisioning_key: webhook.webhook_id,
        trigger_config: {
          webhook_secret: webhook.secret,
          ...(object_id ? { attio_object_id: object_id } : {}),
        },
      };
    },
    // An Attio webhook has no enable flag, and deleting one to turn it off would throw away the
    // signing secret, which can never be read again. So this does nothing on purpose: a disabled
    // row is refused by the delivery route with `trigger_disabled`, which is the same silence with
    // the wire left whole.
    async set_enabled(input) {
      log.info('an Attio webhook has no enable flag; the trigger row is the switch', {
        provisioning_key: input.provisioning_key,
        enabled: input.enabled,
      });
    },
    async delete(input) {
      await delete_attio_webhook(await read_attio_composio_account(input), input.provisioning_key);
    },
  },
};

function attio_delivery_url(trigger_id: string) {
  const base = (env.API_PUBLIC_URL ?? env.API_URL).replace(/\/$/u, '');
  return `${base}/v1/triggers/deliveries/attio/${trigger_id}`;
}

async function read_attio_composio_account(input: TriggerWireOwner): Promise<ComposioAccount> {
  if (!input.connection_id) throw new ValidationError('this ear has no Attio connection');
  const connection = await get_workspace_connection_for_connector(input.db, {
    workspace_id: input.workspace_id,
    connection_id: input.connection_id,
  });
  const connected_account_id = connection && read_connected_account_id(connection);
  if (!connection || !connected_account_id) {
    throw new ValidationError('the Attio connection has no Composio connected account');
  }
  return {
    connected_account_id,
    user_id: connection.external_user_key ?? `ws_${input.workspace_id}`,
  };
}

export function read_trigger_wire(trigger: TriggerRow) {
  const { provisioned_by, provisioning_key } = trigger.trigger_config;
  if (!provisioned_by || !provisioning_key) return null;
  return { provisioned_by, provisioning_key };
}

export function get_trigger_wire_provisioner(provisioned_by: string): TriggerWireProvisioner {
  if (!Object.hasOwn(trigger_wire_provisioners, provisioned_by)) {
    throw new AppError(
      'unknown_trigger_wire_provisioner',
      `Unknown trigger wire provisioner: ${provisioned_by}`,
    );
  }
  return trigger_wire_provisioners[provisioned_by as keyof typeof trigger_wire_provisioners];
}
