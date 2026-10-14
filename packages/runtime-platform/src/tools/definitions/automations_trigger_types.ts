import { env } from '@coworker/config';
import { list_trigger_nodes } from '@coworker/core/db/queries/trigger_provisioning';
import { list_usable_connections } from '@runtime-platform/connections/connection_snapshot';
import {
  automations_app_name,
  input_json_schema,
  output_json_schema,
  read_automation_context,
} from '@runtime-platform/tools/definitions/automations_support';
import {
  read_event_fields,
  read_setup_fields,
  type TriggerNodeFieldSource,
} from '@runtime-platform/tools/definitions/trigger_node_fields';
import {
  list_trigger_types_input_schema,
  trigger_type_output_schema,
  trigger_type_schema,
} from '@runtime-platform/tools/definitions/trigger_type_schemas';
import {
  format_trigger_display_name,
  format_trigger_display_name_without_app,
} from '@runtime-platform/tools/trigger_display_name';
import { keep_trigger_nodes_of_set_up_channels } from '@runtime-platform/tools/trigger_nodes_of_set_up_channels';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';

export const list_trigger_types_tool: RuntimeToolDefinition<
  typeof list_trigger_types_input_schema
> = {
  node_key: 'automations-list_trigger_types-1',
  node_name: 'list_trigger_types',
  display_name: 'List trigger types',
  description:
    'Lists the app events this workspace can watch. Call this first, before create_automation, to find the node_key for what the user wants watched. Each row carries setup_fields (what subscription_config accepts: every required field must be set, with a value of its type, and one of its enum values when it lists them), event_fields (each field a fire carries: `name` is what your conditions rules and judge question read, `label` is how a person reads it), and connected / connection_id (whether its app has an account; when connected is false, create the connection too).',
  category: 'scheduling',
  input_schema: input_json_schema(list_trigger_types_input_schema),
  output_schema: output_json_schema(trigger_type_output_schema),
  app_name: automations_app_name,
  required_connection: false,
  runtime_handler: 'automations.list_trigger_types',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: list_trigger_types_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'automations-list_trigger_types-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;

    const [every_node, connections] = await Promise.all([
      list_trigger_nodes(ctx.db, {
        workspace_id: ctx.workspace_id,
        ...(input.app_name === undefined ? {} : { app_name: input.app_name }),
      }),
      list_usable_connections(ctx.db, {
        workspace_id: ctx.workspace_id,
        ...(context?.participants ? { participants: context.participants } : {}),
        room_private_to: context?.room_private_to,
      }),
    ]);
    const nodes = keep_trigger_nodes_of_set_up_channels(every_node, env);
    const active_connection_by_app = read_active_connection_by_app(connections);
    const trigger_types = nodes.map((node) => ({
      ...describe_trigger_node(node),
      ...read_trigger_connection(node, active_connection_by_app),
    }));

    return {
      success: true,
      data: trigger_type_output_schema.parse({ count: trigger_types.length, trigger_types }),
    };
  },
};

type TriggerNodeRow = TriggerNodeFieldSource & {
  node_key: string;
  node_display_name: string;
  app_name: string;
  app_display_name?: string;
  app_id: string;
  app_auth_type: string | null;
};

export function describe_trigger_node(node: TriggerNodeRow) {
  const display_name = format_trigger_display_name(node.node_display_name, node.app_display_name);
  return trigger_type_schema.parse({
    node_key: node.node_key,
    display_name,
    display_name_without_app: format_trigger_display_name_without_app(
      display_name,
      node.app_display_name,
    ),
    app_name: node.app_name,
    description: node.metadata?.description ?? null,
    setup_fields: read_setup_fields(node),
    event_fields: read_event_fields(node),
  });
}

type ConnectionChoice = {
  connection_id: string;
  connection_name: string | null;
  account_label: string | null;
};

export function read_trigger_connection(
  node: Pick<TriggerNodeRow, 'app_id' | 'app_auth_type' | 'app_name' | 'app_display_name'>,
  active_connection_by_app: Map<string, ConnectionChoice[]>,
) {
  const needs_connection = node.app_auth_type !== 'none';
  const connections = (active_connection_by_app.get(node.app_id) ?? []).map((connection) => ({
    connection_id: connection.connection_id,
    connection_name: connection.connection_name ?? node.app_display_name ?? node.app_name,
    account_label: connection.account_label,
  }));
  const connection_id = connections[0]?.connection_id ?? null;
  return { connected: !needs_connection || connection_id !== null, connection_id, connections };
}

export function read_active_connection_by_app(
  connections: Array<{
    app_id: string;
    connection_id: string;
    connection_status: string;
    connection_name: string | null;
    external_account_name: string | null;
    created_time: Date;
  }>,
) {
  const by_app = new Map<string, ConnectionChoice[]>();
  for (const connection of [...connections].sort(
    (a, b) => b.created_time.getTime() - a.created_time.getTime(),
  )) {
    if (connection.connection_status !== 'active') continue;
    const rows = by_app.get(connection.app_id) ?? [];
    rows.push({
      connection_id: connection.connection_id,
      connection_name: connection.connection_name ?? connection.external_account_name,
      account_label: connection.external_account_name,
    });
    by_app.set(connection.app_id, rows);
  }
  return by_app;
}
