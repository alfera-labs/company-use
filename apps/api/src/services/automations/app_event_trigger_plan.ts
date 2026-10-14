import type { AutomationTriggerInput } from '@api/services/automations/automation_input';
import {
  parse_subscription_numbers,
  refuse_missing_setup_fields,
} from '@api/services/automations/subscription_config_checks';
import {
  choose_trigger_account,
  type TriggerGathering,
} from '@api/services/automations/trigger_account_choice';
import type { DatabaseExecutor } from '@coworker/core';
import { get_tool_catalog_entry } from '@coworker/core/db/queries/catalog';
import type { CreateTriggerInput } from '@coworker/core/db/queries/trigger_writes';
import { ValidationError } from '@coworker/shared';
import { read_connected_account_id } from '@runtime-platform/composio/composio_connect';
import { is_native_trigger_node } from '@runtime-platform/tools/native_trigger_seed';

export const automation_job_handler = 'run_automation';

export type PlannedAutomationTrigger = {
  row: CreateTriggerInput;
  connected_account_id: string | null;
  new_webhook_secret?: string | undefined;
};

type SharedRow = Omit<CreateTriggerInput, 'trigger_type'>;
type AppEventInput = Extract<AutomationTriggerInput, { kind: 'app_event' }>;
type CatalogNode = NonNullable<Awaited<ReturnType<typeof get_tool_catalog_entry>>>;

export async function plan_app_event_trigger(
  db: DatabaseExecutor,
  shared: SharedRow,
  raw_input: AppEventInput,
  gathering: TriggerGathering,
): Promise<PlannedAutomationTrigger> {
  const node = await get_tool_catalog_entry(db, {
    workspace_id: shared.workspace_id,
    node_key: raw_input.node_key,
  });
  const input = { ...raw_input };
  if (node?.node_kind === 'trigger') {
    refuse_missing_setup_fields(node, input.subscription_config);
    input.subscription_config = parse_subscription_numbers(node, input.subscription_config);
  }
  if (node && is_native_trigger_node(node)) return plan_native_ear(shared, node, input);
  return plan_provider_ear(db, shared, node, input, gathering);
}

function plan_native_ear(
  shared: SharedRow,
  node: CatalogNode,
  input: AppEventInput,
): PlannedAutomationTrigger {
  const configured = Object.keys(input.subscription_config).length > 0;
  return {
    connected_account_id: null,
    row: {
      ...shared,
      trigger_type: 'app_event',
      node_id: node.node_id,
      trigger_config: {
        starts_job_handler: automation_job_handler,
        event_source: {
          node_key: input.node_key,
          ...(configured ? { subscription_config: input.subscription_config } : {}),
        },
        rules: input.conditions,
      },
    },
  };
}

async function plan_provider_ear(
  db: DatabaseExecutor,
  shared: SharedRow,
  node: CatalogNode | null,
  input: AppEventInput,
  gathering: TriggerGathering,
): Promise<PlannedAutomationTrigger> {
  const wire = node?.node_config.wire;
  const trigger_slug = wire?.trigger_slug ?? node?.node_config.composio?.trigger_slug;
  if (!node || node.node_kind !== 'trigger' || !trigger_slug?.trim()) {
    throw new ValidationError(`Trigger node ${input.node_key} cannot create an event subscription`);
  }
  const connection = await choose_trigger_account(db, {
    workspace_id: shared.workspace_id,
    app_id: node.app_id,
    connection_id: input.connection_id,
    gathering,
  });
  const connected_account_id = connection ? read_wire_account_id(connection) : null;
  return {
    connected_account_id,
    row: {
      ...shared,
      trigger_type: 'app_event',
      node_id: node.node_id,
      trigger_config: {
        starts_job_handler: automation_job_handler,
        provisioned_by: wire?.provisioned_by ?? 'composio',
        event_source: {
          node_key: input.node_key,
          trigger_slug,
          ...(connection ? { connection_id: connection.connection_id } : {}),
          subscription_config: input.subscription_config,
        },
        rules: input.conditions,
        ...(connected_account_id ? {} : { needs_connection: node.app_display_name }),
      },
    },
  };
}

export function read_wire_account_id(
  connection: Parameters<typeof read_connected_account_id>[0],
): string | null {
  return read_connected_account_id(connection);
}
