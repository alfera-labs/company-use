import { get_all_connector_apps, get_all_connector_nodes } from '@connectors/registry';
import type { ConnectorApp, RegisteredConnectorNode } from '@connectors/types';
import { apps, type Database, nodes } from '@coworker/core';
import type { NodeInputSchemaData } from '@coworker/core/db/schema/json_column_types';
import { build_node_key, create_id, create_logger, id_prefixes } from '@coworker/shared';
import { and, eq, isNull } from 'drizzle-orm';

const actor_id = 'system:connector_catalog';
export const connector_catalog_source = 'connector_registry';
const log = create_logger('connector_catalog_seed');

function connection_profile_key(app: ConnectorApp) {
  return `native:${app.app_key}:default`;
}

function request_origins(app: ConnectorApp) {
  return [new URL(app.base_url).origin];
}

export async function seed_connector_catalog(db: Database) {
  const visible_apps = get_all_connector_apps().filter((app) => !app.hidden);
  await seed_connector_catalog_entries(db, visible_apps, get_all_connector_nodes());
}

export async function seed_connector_catalog_entries(
  db: Database,
  connector_apps: readonly ConnectorApp[],
  registered_nodes: readonly RegisteredConnectorNode[],
) {
  const nodes_by_app = group_nodes_by_app(registered_nodes);

  for (const app of connector_apps) {
    const installed = await upsert_connector_app(db, app);
    if (!installed?.owns_the_app_row) continue;
    for (const node of nodes_by_app.get(app.app_key) ?? []) {
      await upsert_connector_node(db, installed.app_row, node);
    }
  }
}

function group_nodes_by_app(registered_nodes: readonly RegisteredConnectorNode[]) {
  const grouped = new Map<string, RegisteredConnectorNode[]>();
  for (const node of registered_nodes) {
    const current = grouped.get(node.app_key) ?? [];
    current.push(node);
    grouped.set(node.app_key, current);
  }
  return grouped;
}

const auth_method_keys = {
  oauth2: 'oauth2_authorization_code',
  api_key: 'api_key',
  none: 'none',
} as const;

export function connector_client_id_env(app_key: string) {
  return `CONNECTOR_${app_key.toUpperCase()}_CLIENT_ID`;
}

export function connector_client_secret_env(app_key: string) {
  return `CONNECTOR_${app_key.toUpperCase()}_CLIENT_SECRET`;
}

function setup_strategy(app: ConnectorApp) {
  const auth = app.auth;
  if (auth.kind !== 'oauth2' || !auth.auth_url || !auth.token_url) return {};
  return {
    type: 'oauth2_authorization_code',
    authorization_url: auth.auth_url,
    token_url: auth.token_url,
    client_id_env: connector_client_id_env(app.app_key),
    client_secret_env: connector_client_secret_env(app.app_key),
    scopes: [...(auth.scopes ?? [])],
    authorization_params: { ...(auth.authorization_params ?? {}) },
    token_auth_method: auth.token_auth_method ?? 'client_secret_post',
    token_request_format: auth.token_request_format ?? 'form',
    scope_separator: auth.scope_separator ?? 'space',
    use_pkce: false,
  };
}

function connector_app_values(app: ConnectorApp) {
  return {
    app_name: app.app_key,
    app_key: app.app_key,
    catalog_scope: 'global',
    app_display_name: app.display_name,
    app_category: 'connectors',
    auth_type: app.auth.kind,
    app_status: 'active',
    allowed_request_origins: request_origins(app),
    display_config: {},
    metadata: {
      source: connector_catalog_source,
      sourced_from: { provider: 'native', provider_app_id: `native:${app.app_key}` },
      provider_configs: [
        {
          provider_key: 'native',
          provider_config_key: `native:${app.app_key}`,
          version: 1,
          status: 'active' as const,
          provider_app_key: app.app_key,
          setup_defaults: {},
          connection_profiles: [
            {
              connection_profile_key: connection_profile_key(app),
              auth_method_key: auth_method_keys[app.auth.kind],
              setup_strategy: setup_strategy(app),
              runtime_credential_strategy: { deliver: 'authorization_bearer' },
              default_scopes: [...(app.auth.scopes ?? [])],
              version: 1,
              status: 'active' as const,
            },
          ],
        },
      ],
    },
  };
}

async function upsert_connector_app(db: Database, app: ConnectorApp) {
  const values = connector_app_values(app);
  const existing_app = await db.query.apps.findFirst({
    where: and(
      eq(apps.app_name, app.app_key),
      eq(apps.catalog_scope, 'global'),
      isNull(apps.workspace_id),
    ),
  });

  if (existing_app && existing_app.metadata.source !== connector_catalog_source) {
    const app_row =
      app.availability?.status === 'held'
        ? await remove_native_provider_config(db, existing_app)
        : await add_native_provider_config(db, existing_app, values);
    return { app_row, owns_the_app_row: false };
  }

  if (existing_app) {
    const [row] = await db
      .update(apps)
      .set({ ...values, last_updated_time: new Date(), last_updated_by: actor_id })
      .where(eq(apps.app_id, existing_app.app_id))
      .returning();
    if (!row) throw new Error(`Connector app seed failed: ${app.app_key}`);
    return { app_row: row, owns_the_app_row: true };
  }

  const [row] = await db
    .insert(apps)
    .values({
      app_id: create_id(id_prefixes.app),
      ...values,
      created_by: actor_id,
      last_updated_by: actor_id,
    })
    .returning();
  if (!row) throw new Error(`Connector app seed failed: ${app.app_key}`);
  return { app_row: row, owns_the_app_row: true };
}

async function remove_native_provider_config(db: Database, existing_app: typeof apps.$inferSelect) {
  const current = existing_app.metadata.provider_configs ?? [];
  const foreign = current.filter((config) => config.source !== connector_catalog_source);
  if (foreign.length === current.length) return existing_app;

  const [row] = await db
    .update(apps)
    .set({
      metadata: { ...existing_app.metadata, provider_configs: foreign },
      last_updated_time: new Date(),
      last_updated_by: actor_id,
    })
    .where(eq(apps.app_id, existing_app.app_id))
    .returning();
  if (!row) throw new Error(`Connector app seed failed: ${existing_app.app_name}`);
  log.info(
    `Connector app ${existing_app.app_name} is held; removed the native way to connect from its row.`,
  );
  return row;
}

async function add_native_provider_config(
  db: Database,
  existing_app: typeof apps.$inferSelect,
  values: ReturnType<typeof connector_app_values>,
) {
  const native_configs = values.metadata.provider_configs.map((config) => ({
    ...config,
    source: connector_catalog_source,
  }));
  const current = (existing_app.metadata.provider_configs ?? []) as typeof native_configs;
  const foreign = current.filter((config) => config.source !== connector_catalog_source);
  const native_keys = new Set(native_configs.map((config) => config.provider_config_key));
  if (foreign.some((config) => native_keys.has(config.provider_config_key))) {
    log.info(
      `Connector app ${existing_app.app_name} already offers its own native way to connect; leaving it alone.`,
    );
    return existing_app;
  }

  const provider_configs = [...foreign, ...native_configs];
  const [row] = await db
    .update(apps)
    .set({
      metadata: { ...existing_app.metadata, provider_configs },
      last_updated_time: new Date(),
      last_updated_by: actor_id,
    })
    .where(eq(apps.app_id, existing_app.app_id))
    .returning();
  if (!row) throw new Error(`Connector app seed failed: ${existing_app.app_name}`);
  log.info(
    `Connector app ${existing_app.app_name} is owned by ${existing_app.metadata.source ?? 'another catalog'}; added the native way to connect beside it.`,
  );
  return row;
}

function connector_node_values(
  app_row: typeof apps.$inferSelect,
  registered: RegisteredConnectorNode,
) {
  const node_key = build_node_key({
    app_name: registered.app_key,
    node_name: registered.node_name,
    node_version: registered.node_version,
  });
  if (node_key !== registered.node_key) {
    throw new Error(`Connector node_key does not match its fields: ${registered.node_key}`);
  }
  return {
    app_id: app_row.app_id,
    app_key: app_row.app_key,
    catalog_scope: 'global',
    node_key,
    node_version: registered.node_version,
    node_name: registered.node_name,
    node_display_name: registered.node.display_name ?? registered.node_name,
    node_kind: 'tool',
    input_schema: registered.node.input_schema as NodeInputSchemaData,
    output_schema: registered.node.output_schema,
    approval_policy: {},
    runtime_handler: `connectors.${node_key}`,
    node_runtime: 'connected_app',
    node_status: 'active',
    discovery_status: 'visible',
    provider_key: 'native',
    provider_config_key: `native:${registered.app_key}`,
    provider_config_version: 1,
    connection_profile_key: connection_profile_key(registered.app),
    connection_profile_version: 1,
    required_scopes: [...(registered.node.required_scopes ?? registered.app.auth.scopes ?? [])],
    required_account_properties: [],
    node_config: {
      sourced_from: {
        provider: 'native',
        provider_app_id: `native:${registered.app_key}`,
        provider_component_id: registered.source_path,
        provider_component_version: String(registered.node_version),
      },
    },
    metadata: {
      source: connector_catalog_source,
      node_key,
      description: registered.node.description,
      category: 'connectors',
      app_name: registered.app_key,
      required_connection: true,
      atomic: registered.node.atomic ?? false,
      source_path: registered.source_path,
    },
  };
}

async function upsert_connector_node(
  db: Database,
  app_row: typeof apps.$inferSelect,
  registered: RegisteredConnectorNode,
) {
  const values = connector_node_values(app_row, registered);
  const [row] = await db
    .insert(nodes)
    .values({
      node_id: create_id(id_prefixes.node),
      ...values,
      created_by: actor_id,
      last_updated_by: actor_id,
    })
    .onConflictDoUpdate({
      target: [nodes.app_id, nodes.node_name],
      set: { ...values, last_updated_time: new Date(), last_updated_by: actor_id },
    })
    .returning({ node_id: nodes.node_id });

  if (!row) throw new Error(`Connector node seed failed: ${registered.node_key}`);
}
