import type { Database } from '@coworker/core/db/connection';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { apps, nodes } from '@coworker/core/db/schema';
import type {
  AppMetadataData,
  AppProviderConfigData,
  ConnectionProfileData,
} from '@coworker/core/db/schema/json_column_types';
import {
  type ComposioAppSeed,
  type ComposioNodeSeed,
  find_active_composio_profile,
} from '@coworker/core/integrations/composio_catalog';
import { composio_provider_key } from '@coworker/core/integrations/composio_schema';
import {
  type ExistingProviderNodeIdentity,
  preserve_provider_node_names,
} from '@coworker/core/integrations/provider_catalog_identity';
import {
  build_node_key,
  catalog_node_version_maximum,
  create_id,
  id_prefixes,
} from '@coworker/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

// One multi-row statement per batch, so a toolkit with a thousand tools is two statements rather
// than a thousand round trips. A node row carries about 25 columns, so 500 rows stays well under
// the 65535 bind parameters one statement allows.
const database_batch_size = 500;

// `db.transaction(fn)` hands its callback a transaction, not a `Database`. Every write below takes
// either one, so the sync can put a toolkit's app row, its rename, and its nodes in one
// transaction while a test calls the same function with the database directly. The caller owns the
// transaction: nothing here opens one for a single statement group.
export type ComposioCatalogWriteHandle = Pick<
  Database,
  'query' | 'select' | 'insert' | 'update' | 'delete'
>;

export type ComposioNodeWriteResult = {
  nodes_created: number;
  nodes_updated: number;
  nodes_deleted: number;
  empty_toolkit_refused: boolean;
  inactive_connection_profile: {
    connection_profile_key: string;
    disabled_reason: string | null;
  } | null;
};

// `inserted` says whether this call created the row, which is what the sync counts as an app
// created rather than updated. `xmax = 0` is true only for the INSERT branch of the upsert.
export async function upsert_composio_app(
  db: ComposioCatalogWriteHandle,
  input: { app_seed: ComposioAppSeed; app_display_name?: string | undefined; actor_id: string },
): Promise<{ app_id: string; inserted: boolean }> {
  const app_seed = input.app_seed;
  const existing_app = await db.query.apps.findFirst({
    columns: { metadata: true },
    where: and(
      eq(apps.app_name, app_seed.app_name),
      eq(apps.catalog_scope, 'global'),
      isNull(apps.workspace_id),
    ),
  });
  const existing_source = existing_app?.metadata.source ?? null;
  if (existing_app && existing_source !== composio_provider_key) {
    throw new Error(
      `Refusing to rebind app_name ${app_seed.app_name} owned by ${existing_source ?? 'another catalog'}`,
    );
  }

  const columns = {
    ...composio_app_columns(app_seed, existing_app?.metadata),
    app_name: app_seed.app_name,
    app_display_name: input.app_display_name ?? app_seed.app_display_name,
    catalog_scope: 'global',
    display_config: {},
  };
  const [row] = await db
    .insert(apps)
    .values({
      ...columns,
      app_id: create_id(id_prefixes.app),
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .onConflictDoUpdate({
      target: apps.app_name,
      targetWhere: sql`${apps.catalog_scope} = 'global' AND ${apps.workspace_id} IS NULL`,
      set: { ...columns, last_updated_time: new Date(), last_updated_by: input.actor_id },
    })
    .returning({
      app_id: apps.app_id,
      inserted: sql<boolean>`(xmax = 0)`.as('inserted'),
    });
  return require_inserted_row(row, `Composio app ${app_seed.app_name}`);
}

export async function upsert_composio_nodes(
  db: ComposioCatalogWriteHandle,
  input: {
    app_id: string;
    app_seed: ComposioAppSeed;
    node_seeds: ComposioNodeSeed[];
    actor_id: string;
    existing_nodes?: ExistingProviderNodeIdentity[] | undefined;
  },
): Promise<ComposioNodeWriteResult> {
  const provider_config = read_composio_provider_config(input.app_seed);
  const { profile, is_active } = read_connection_profile(input.app_seed, provider_config);
  const inactive_connection_profile = is_active
    ? null
    : {
        connection_profile_key: profile.connection_profile_key,
        disabled_reason: read_disabled_reason(profile.setup_strategy.disabled_reason),
      };

  if (input.node_seeds.length === 0) {
    return {
      nodes_created: 0,
      nodes_updated: 0,
      nodes_deleted: 0,
      empty_toolkit_refused: true,
      inactive_connection_profile,
    };
  }

  const existing_nodes =
    input.existing_nodes ?? (await read_existing_composio_nodes(db, input.app_id));
  const resolved_seeds = preserve_provider_node_names(input.node_seeds, existing_nodes);
  const existing_by_name = new Map(existing_nodes.map((node) => [node.node_name, node]));

  const rows = resolved_seeds.map((seed) =>
    composio_node_row({
      app_id: input.app_id,
      seed,
      provider_config,
      profile,
      actor_id: input.actor_id,
      existing: existing_by_name.get(seed.node_name),
    }),
  );

  const written: Array<{ created: boolean }> = [];
  for (const batch of batches_of(rows, database_batch_size)) {
    written.push(...(await upsert_composio_node_batch(db, batch, input.actor_id)));
  }
  const nodes_deleted = await delete_vanished_composio_nodes(db, {
    app_id: input.app_id,
    existing_nodes,
    written_node_names: new Set(rows.map((row) => row.node_name)),
  });

  return {
    nodes_created: written.filter((result) => result.created).length,
    nodes_updated: written.filter((result) => !result.created).length,
    nodes_deleted,
    empty_toolkit_refused: false,
    inactive_connection_profile,
  };
}

export async function read_composio_nodes_by_app(
  db: ComposioCatalogWriteHandle,
  app_ids: string[],
): Promise<Map<string, ExistingProviderNodeIdentity[]>> {
  const nodes_by_app_id = new Map<string, ExistingProviderNodeIdentity[]>();

  for (const batch of batches_of(app_ids, database_batch_size)) {
    const rows = await db
      .select({
        app_id: nodes.app_id,
        node_name: nodes.node_name,
        node_version: nodes.node_version,
        node_config: nodes.node_config,
      })
      .from(nodes)
      .where(and(eq(nodes.provider_key, composio_provider_key), inArray(nodes.app_id, batch)));

    for (const row of rows) {
      const app_nodes = nodes_by_app_id.get(row.app_id);
      if (app_nodes) app_nodes.push(row);
      else nodes_by_app_id.set(row.app_id, [row]);
    }
  }

  return nodes_by_app_id;
}

export async function read_global_app_ids_by_name(
  db: ComposioCatalogWriteHandle,
  app_names: string[],
): Promise<Map<string, string>> {
  const app_ids_by_name = new Map<string, string>();

  for (const batch of batches_of(app_names, database_batch_size)) {
    const rows = await db
      .select({ app_id: apps.app_id, app_name: apps.app_name })
      .from(apps)
      .where(
        and(
          eq(apps.catalog_scope, 'global'),
          isNull(apps.workspace_id),
          inArray(apps.app_name, batch),
        ),
      );
    for (const row of rows) app_ids_by_name.set(row.app_name, row.app_id);
  }

  return app_ids_by_name;
}

function build_composio_app_metadata(
  app_seed: ComposioAppSeed,
  existing_metadata?: AppMetadataData,
): AppMetadataData {
  const foreign_configs = (existing_metadata?.provider_configs ?? []).filter(
    (config) => config.provider_key !== composio_provider_key,
  );
  return {
    ...app_seed.metadata,
    provider_configs: [...(app_seed.metadata.provider_configs ?? []), ...foreign_configs],
  };
}

function composio_app_columns(app_seed: ComposioAppSeed, existing_metadata?: AppMetadataData) {
  return {
    app_key: app_seed.app_key,
    app_display_name: app_seed.app_display_name,
    app_category: app_seed.app_category,
    auth_type: app_seed.auth_type,
    app_status: 'active',
    allowed_request_origins: app_seed.allowed_request_origins,
    metadata: build_composio_app_metadata(app_seed, existing_metadata),
  };
}

async function read_existing_composio_nodes(
  db: ComposioCatalogWriteHandle,
  app_id: string,
): Promise<ExistingProviderNodeIdentity[]> {
  return db
    .select({
      node_name: nodes.node_name,
      node_version: nodes.node_version,
      node_config: nodes.node_config,
    })
    .from(nodes)
    .where(and(eq(nodes.app_id, app_id), eq(nodes.provider_key, composio_provider_key)));
}

async function delete_vanished_composio_nodes(
  db: ComposioCatalogWriteHandle,
  input: {
    app_id: string;
    existing_nodes: ExistingProviderNodeIdentity[];
    written_node_names: Set<string>;
  },
) {
  const vanished_node_names = input.existing_nodes
    .map((node) => node.node_name)
    .filter((node_name) => !input.written_node_names.has(node_name));
  if (vanished_node_names.length === 0) return 0;

  let nodes_deleted = 0;
  for (const batch of batches_of(vanished_node_names, database_batch_size)) {
    const deleted_rows = await db
      .delete(nodes)
      .where(
        and(
          eq(nodes.app_id, input.app_id),
          eq(nodes.provider_key, composio_provider_key),
          inArray(nodes.node_name, batch),
        ),
      )
      .returning({ node_id: nodes.node_id });
    nodes_deleted += deleted_rows.length;
  }
  return nodes_deleted;
}

function read_composio_provider_config(app_seed: ComposioAppSeed) {
  const provider_config = app_seed.metadata.provider_configs?.[0];
  if (!provider_config) {
    throw new Error(`Composio app seed carries no provider config: ${app_seed.app_name}`);
  }
  return provider_config;
}

// Nodes point at the way to connect a person will actually use. A toolkit whose only OAuth app
// Composio does not host has no active profile: it is still imported, pointing at the profile
// that will work once an operator creates a custom auth config.
function read_connection_profile(
  app_seed: ComposioAppSeed,
  config: AppProviderConfigData,
): { profile: ConnectionProfileData; is_active: boolean } {
  const active_profile = find_active_composio_profile(config);
  if (active_profile) return { profile: active_profile, is_active: true };

  const first_profile = config.connection_profiles[0];
  if (!first_profile) {
    throw new Error(`Composio app seed carries no connection profile: ${app_seed.app_name}`);
  }
  return { profile: first_profile, is_active: false };
}

function composio_node_row(input: {
  app_id: string;
  seed: ComposioNodeSeed;
  provider_config: AppProviderConfigData;
  profile: ConnectionProfileData;
  actor_id: string;
  existing?: ExistingProviderNodeIdentity | undefined;
}): typeof nodes.$inferInsert {
  const { seed, provider_config, profile } = input;
  const node_version = next_node_version(seed, input.existing);
  return {
    node_id: create_id(id_prefixes.node),
    app_id: input.app_id,
    app_key: seed.app_key,
    node_name: seed.node_name,
    catalog_scope: 'global',
    node_key: build_node_key({
      app_name: seed.app_name,
      node_name: seed.node_name,
      node_version,
    }),
    node_version,
    node_display_name: seed.node_display_name,
    node_kind: seed.node_kind,
    input_schema: seed.input_schema,
    output_schema: seed.output_schema,
    approval_policy: seed.approval_policy,
    runtime_handler: seed.runtime_handler,
    node_runtime: seed.node_runtime,
    node_status: seed.node_status,
    discovery_status: 'visible',
    provider_key: composio_provider_key,
    provider_config_key: provider_config.provider_config_key,
    provider_config_version: provider_config.version,
    connection_profile_key: profile.connection_profile_key,
    connection_profile_version: profile.version,
    required_scopes: seed.required_scopes,
    required_account_properties: [],
    node_config: seed.node_config,
    metadata: seed.metadata,
    created_by: input.actor_id,
    last_updated_by: input.actor_id,
  };
}

async function upsert_composio_node_batch(
  db: Pick<Database, 'insert'>,
  rows: Array<typeof nodes.$inferInsert>,
  actor_id: string,
) {
  return db
    .insert(nodes)
    .values(rows)
    .onConflictDoUpdate({
      target: [nodes.app_id, nodes.node_name],
      set: {
        app_key: sql`excluded.app_key`,
        node_display_name: sql`excluded.node_display_name`,
        catalog_scope: sql`excluded.catalog_scope`,
        node_key: sql`excluded.node_key`,
        node_version: sql`excluded.node_version`,
        node_kind: sql`excluded.node_kind`,
        input_schema: sql`excluded.input_schema`,
        output_schema: sql`excluded.output_schema`,
        approval_policy: sql`excluded.approval_policy`,
        runtime_handler: sql`excluded.runtime_handler`,
        node_runtime: sql`excluded.node_runtime`,
        node_status: sql`excluded.node_status`,
        discovery_status: sql`excluded.discovery_status`,
        provider_key: sql`excluded.provider_key`,
        provider_config_key: sql`excluded.provider_config_key`,
        provider_config_version: sql`excluded.provider_config_version`,
        connection_profile_key: sql`excluded.connection_profile_key`,
        connection_profile_version: sql`excluded.connection_profile_version`,
        required_scopes: sql`excluded.required_scopes`,
        required_account_properties: sql`excluded.required_account_properties`,
        node_config: sql`excluded.node_config`,
        metadata: sql`excluded.metadata`,
        last_updated_time: new Date(),
        last_updated_by: actor_id,
      },
    })
    .returning({
      node_id: nodes.node_id,
      created: sql<boolean>`(xmax = 0)`.as('created'),
    });
}

function next_node_version(seed: ComposioNodeSeed, existing?: ExistingProviderNodeIdentity) {
  const node_version = existing?.node_version ?? seed.node_version;
  if (node_version > catalog_node_version_maximum) {
    throw new Error(`node_version exceeds ${catalog_node_version_maximum}: ${seed.node_key}`);
  }
  return node_version;
}

function read_disabled_reason(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function batches_of<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
