import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { list_trigger_nodes } from '@coworker/core/db/queries/trigger_provisioning';
import { list_usable_connections } from '@runtime-platform/connections/connection_snapshot';
import {
  describe_trigger_node,
  read_active_connection_by_app,
  read_trigger_connection,
} from '@runtime-platform/tools/definitions/automations_trigger_types';
import { keep_trigger_nodes_of_set_up_channels } from '@runtime-platform/tools/trigger_nodes_of_set_up_channels';

type TriggerNodeRow = Awaited<ReturnType<typeof list_trigger_nodes>>[number];

export type TriggerTypeRow = ReturnType<typeof describe_trigger_node> & {
  input_schema: unknown;
};

export type TriggerTypeApp = {
  app_id: string;
  app_name: string;
  app_display_name: string;
  icon_url: string | null;
  needs_connection: boolean;
  connected: boolean;
  connection_id: string | null;
  connections: { connection_id: string; connection_name: string; account_label: string | null }[];
  trigger_types: TriggerTypeRow[];
};

type ConnectionsByApp = ReturnType<typeof read_active_connection_by_app>;

export async function list_workspace_trigger_types(
  db: Database,
  input: { workspace_id: string; user_id: string },
): Promise<{ count: number; apps: TriggerTypeApp[] }> {
  const [every_node, connections] = await Promise.all([
    list_trigger_nodes(db, { workspace_id: input.workspace_id, limit: 2000 }),
    list_usable_connections(db, {
      workspace_id: input.workspace_id,
      participants: { project: [], user: [input.user_id], agent: [] },
      room_private_to: input.user_id,
    }),
  ]);
  const nodes = keep_trigger_nodes_of_set_up_channels(every_node, env);
  const active_connection_by_app = read_active_connection_by_app(connections);
  const apps = group_by_app(nodes, active_connection_by_app);
  return { count: nodes.length, apps };
}

function group_by_app(
  nodes: TriggerNodeRow[],
  active_connection_by_app: ConnectionsByApp,
): TriggerTypeApp[] {
  const by_app = new Map<string, TriggerTypeApp>();
  for (const node of nodes) {
    const app = by_app.get(node.app_id) ?? describe_app(node, active_connection_by_app);
    app.trigger_types.push({ ...describe_trigger_node(node), input_schema: node.input_schema });
    by_app.set(node.app_id, app);
  }
  return [...by_app.values()]
    .map((app) => ({
      ...app,
      trigger_types: app.trigger_types.sort((a, b) => a.display_name.localeCompare(b.display_name)),
    }))
    .sort((a, b) => a.app_display_name.localeCompare(b.app_display_name));
}

function describe_app(
  node: TriggerNodeRow,
  active_connection_by_app: ConnectionsByApp,
): TriggerTypeApp {
  return {
    app_id: node.app_id,
    app_name: node.app_name,
    app_display_name: node.app_display_name,
    icon_url: read_icon_url(node.app_metadata) ?? read_icon_url(node.app_display_config),
    needs_connection: node.app_auth_type !== 'none',
    ...read_trigger_connection(node, active_connection_by_app),
    trigger_types: [],
  };
}

function read_icon_url(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  const icon_url = (config as { icon_url?: unknown }).icon_url;
  return typeof icon_url === 'string' && icon_url.trim() ? icon_url : null;
}
