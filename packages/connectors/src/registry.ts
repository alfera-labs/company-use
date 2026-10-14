import { connector_app_modules, connector_node_modules } from '@connectors/apps/index';
import { load_connector_app, load_connector_node } from '@connectors/load_definition';
import { is_read_content } from '@connectors/sync_definition/sync_object_schema';
import type {
  ConnectorApp,
  ConnectorAppModule,
  ConnectorNodeModule,
  RegisteredConnectorNode,
} from '@connectors/types';
import { build_node_key } from '@coworker/shared';

export type ConnectorRegistry = {
  apps: Map<string, ConnectorApp>;
  nodes: Map<string, RegisteredConnectorNode>;
};

const app_path_pattern = /^apps\/([a-z0-9_]+)\/app\.json$/u;
const node_path_pattern = /^apps\/([a-z0-9_]+)\/([a-z0-9_]+)\/v(\d+)\/node\.json$/u;

type ConnectorNodePath = {
  app_key: string;
  node_name: string;
  node_version: number;
};

function parse_connector_node_path(source_path: string): ConnectorNodePath {
  const match = node_path_pattern.exec(source_path);
  if (!match) {
    throw new Error(`Connector node path must be apps/{app}/{node}/v{n}/node.json: ${source_path}`);
  }
  const [, app_key = '', node_name = '', version_text = ''] = match;
  return { app_key, node_name, node_version: Number(version_text) };
}

function parse_connector_app_path(source_path: string) {
  const match = app_path_pattern.exec(source_path);
  if (!match) {
    throw new Error(`Connector app path must be apps/{app}/app.json: ${source_path}`);
  }
  return { app_key: match[1] as string };
}

function build_app_map(app_modules: readonly ConnectorAppModule[]) {
  const apps = new Map<string, ConnectorApp>();
  for (const module of app_modules) {
    const { app_key } = parse_connector_app_path(module.source_path);
    const app = load_connector_app(module.source_path, module.definition);
    if (app_key !== app.app_key) {
      throw new Error(
        `Connector app path and app_key disagree: ${module.source_path} declares ${app.app_key}`,
      );
    }
    if (apps.has(app_key)) {
      throw new Error(`Duplicate connector app: ${app_key}`);
    }
    apps.set(app_key, app);
  }
  return apps;
}

function register_node(
  apps: Map<string, ConnectorApp>,
  nodes: Map<string, RegisteredConnectorNode>,
  module: ConnectorNodeModule,
) {
  const path = parse_connector_node_path(module.source_path);
  const app = apps.get(path.app_key);
  if (!app) {
    throw new Error(`Connector node has no app.json: ${module.source_path}`);
  }
  const node = load_connector_node(module.source_path, module.definition, module.execute_module);
  const node_key = build_node_key({
    app_name: path.app_key,
    node_name: path.node_name,
    node_version: path.node_version,
  });
  if (node_key !== node.node_key) {
    throw new Error(
      `Connector node path and node_key disagree: ${module.source_path} declares ${node.node_key}, path says ${node_key}`,
    );
  }
  if (nodes.has(node_key)) {
    throw new Error(`Duplicate connector node_key: ${node_key}`);
  }
  nodes.set(node_key, {
    ...path,
    node_key,
    app,
    node,
    source_path: module.source_path,
  });
}

export function build_connector_registry(
  app_modules: readonly ConnectorAppModule[],
  node_modules: readonly ConnectorNodeModule[],
): ConnectorRegistry {
  const apps = build_app_map(app_modules);
  const nodes = new Map<string, RegisteredConnectorNode>();
  for (const module of node_modules) register_node(apps, nodes, module);
  check_browse_nodes_exist(apps, nodes);
  check_search_params_exist(apps, nodes);
  check_sync_object_nodes_exist(apps, nodes);
  check_sync_directory_node_exists(apps, nodes);
  return { apps, nodes };
}

function check_sync_directory_node_exists(
  apps: Map<string, ConnectorApp>,
  nodes: Map<string, RegisteredConnectorNode>,
) {
  for (const app of apps.values()) {
    const list_node = app.sync?.directory?.list_node;
    if (!list_node || nodes.has(list_node)) continue;
    throw new Error(
      `Connector app ${app.app_key} crawls its people directory through ${list_node}, which is not a registered node.`,
    );
  }
}

function check_sync_object_nodes_exist(
  apps: Map<string, ConnectorApp>,
  nodes: Map<string, RegisteredConnectorNode>,
) {
  for (const app of apps.values()) {
    for (const [object_key, object] of Object.entries(app.sync?.objects ?? {})) {
      const named = [
        object.list_node,
        ...(is_read_content(object.content) ? [object.content.read_node] : []),
      ];
      for (const node_key of named) {
        if (nodes.has(node_key)) continue;
        throw new Error(
          `Connector app ${app.app_key} syncs ${object_key} through ${node_key}, which is not a registered node.`,
        );
      }
    }
  }
}

function check_browse_nodes_exist(
  apps: Map<string, ConnectorApp>,
  nodes: Map<string, RegisteredConnectorNode>,
) {
  for (const app of apps.values()) {
    for (const dimension of app.sync?.dimensions ?? []) {
      if (!dimension.browse_node || nodes.has(dimension.browse_node)) continue;
      throw new Error(
        `Connector app ${app.app_key} syncs ${dimension.key} through ${dimension.browse_node}, which is not a registered node.`,
      );
    }
  }
}

function check_search_params_exist(
  apps: Map<string, ConnectorApp>,
  nodes: Map<string, RegisteredConnectorNode>,
) {
  for (const app of apps.values()) {
    for (const dimension of app.sync?.dimensions ?? []) {
      if (!dimension.search_param || !dimension.browse_node) continue;
      const input_schema = nodes.get(dimension.browse_node)?.node.input_schema as
        | { properties?: Record<string, unknown> }
        | undefined;
      if (input_schema?.properties && dimension.search_param in input_schema.properties) continue;
      throw new Error(
        `Connector app ${app.app_key} searches ${dimension.key} with ${dimension.search_param}, which ${dimension.browse_node} does not take as an input.`,
      );
    }
  }
}

const registry = build_connector_registry(connector_app_modules, connector_node_modules);

export function get_all_connector_nodes(): RegisteredConnectorNode[] {
  return [...registry.nodes.values()];
}

export function get_connector_node(node_key: string): RegisteredConnectorNode | null {
  return registry.nodes.get(node_key) ?? null;
}

export function get_connector_app(app_key: string): ConnectorApp | null {
  return registry.apps.get(app_key) ?? null;
}

export function get_all_connector_apps(): ConnectorApp[] {
  return [...registry.apps.values()];
}

export function read_connector_app_hold(app_key: string): { reason: string } | null {
  const availability = registry.apps.get(app_key)?.availability;
  return availability?.status === 'held' ? { reason: availability.reason } : null;
}

export function is_connector_app_held(app_key: string): boolean {
  return read_connector_app_hold(app_key) !== null;
}
