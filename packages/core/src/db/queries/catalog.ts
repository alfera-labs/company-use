import { product_brand_config } from '@coworker/config';
import {
  empty_participants,
  may_use_resource,
  type Participants,
} from '@coworker/core/access/may_use_resource';
import { resource_type_definitions } from '@coworker/core/access/resource_types';
import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { offered_to_anyone } from '@coworker/core/db/queries/catalog_twin_offer';
import {
  list_grants_for_resources,
  type ResourceGrantRow,
  read_grant_rules,
} from '@coworker/core/db/queries/resource_grants';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import { settings_only_discovery_status } from '@coworker/core/integrations/alfera_api_tools';
import { validate_node_execution_compatibility } from '@coworker/core/integrations/connection_compatibility';
import { model_provider_account_app_names } from '@coworker/core/integrations/model_provider_account_slots';
import { api_proxy_runtime_handlers } from '@coworker/core/integrations/provider_runtime_handlers';
import { create_id, format_error_message, id_prefixes, ValidationError } from '@coworker/shared';
import { and, asc, eq, inArray, isNull, ne, notInArray, or, type SQL, sql } from 'drizzle-orm';

const actor_id = 'system:catalog';

export const not_a_model_credential_app: SQL = notInArray(apps.app_name, [
  ...model_provider_account_app_names,
]);

// Which apps may this workspace be offered? Every active app, plus a `superseded` app the
// workspace already has a connection to. A superseded row is the old provider's entry of an app
// that now has a Composio `_v2` beside it:
// nobody new is offered it, and the workspace still holding its connection keeps seeing it under
// its `(legacy)` name. Every listing, search, and lookup carries this; execution does not, so a
// connection to the old app keeps working.
//
// The table names are written out rather than passed as column objects: the relational query
// builder rewrites every column object in a `where` onto the table it selects from, which would
// turn `connections.workspace_id` into `apps.workspace_id`.
//
export function app_offer_condition(workspace_id: string | undefined): SQL {
  if (!workspace_id) return offered_to_anyone;
  return sql`(${offered_to_anyone}
    OR (apps.app_status IN ('active', 'superseded') AND EXISTS (
      SELECT 1 FROM connections offered_app_connections
      WHERE offered_app_connections.workspace_id = ${workspace_id}
        AND offered_app_connections.app_id = apps.app_id
    )))`;
}

function node_app_offer_condition(workspace_id: string | undefined): SQL {
  return sql`EXISTS (
    SELECT 1 FROM apps WHERE apps.app_id = nodes.app_id AND ${app_offer_condition(workspace_id)}
  )`;
}

export async function seed_internal_catalog(db: Database) {
  const product_brand_name = product_brand_config.product_brand_name;
  const existing_app = await db.query.apps.findFirst({
    where: and(
      eq(apps.app_name, 'runtime'),
      eq(apps.catalog_scope, 'global'),
      isNull(apps.workspace_id),
    ),
  });
  const app_id = existing_app?.app_id ?? create_id(id_prefixes.app);

  if (!existing_app) {
    await db.insert(apps).values({
      app_id,
      app_name: 'runtime',
      app_key: 'runtime',
      catalog_scope: 'global',
      app_display_name: `${product_brand_name} runtime`,
      app_category: 'internal',
      auth_type: 'internal',
      app_status: 'active',
      display_config: {},
      metadata: {
        sourced_from: {
          provider: 'native',
          provider_app_id: 'native:runtime',
        },
      },
      created_by: actor_id,
      last_updated_by: actor_id,
    });
  }

  const existing_node = await db.query.nodes.findFirst({
    where: and(eq(nodes.app_id, app_id), eq(nodes.node_name, 'search_context')),
  });

  if (!existing_node) {
    await db.insert(nodes).values({
      node_id: create_id(id_prefixes.node),
      app_id,
      app_key: 'runtime',
      node_name: 'search_context',
      catalog_scope: 'global',
      node_key: 'runtime-search_context-1',
      node_version: 1,
      node_display_name: 'Search context',
      node_kind: 'tool',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      output_schema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
      },
      runtime_handler: 'runtime.search_context',
      node_runtime: 'native_tool',
      node_status: 'active',
      discovery_status: 'visible',
      provider_key: 'native',
      provider_config_key: 'native:runtime',
      provider_config_version: 1,
      node_config: {
        sourced_from: {
          provider: 'native',
          provider_app_id: 'native:runtime',
          provider_component_id: 'runtime.search_context',
          provider_component_version: '1',
        },
      },
      created_by: actor_id,
      last_updated_by: actor_id,
    });
  }
}

export async function list_apps(db: Database, workspace_id?: string) {
  return db.query.apps.findMany({
    where: and(
      app_offer_condition(workspace_id),
      not_a_model_credential_app,
      ...(workspace_id ? [app_visibility_condition(workspace_id)] : []),
    ),
    orderBy: (table, { asc }) => [asc(table.app_name)],
  });
}

export async function list_apps_by_normalized_keys(
  db: Database,
  input: { keys: string[]; workspace_id?: string | undefined },
) {
  const keys = [...new Set(input.keys.map(normalize_catalog_key).filter(Boolean))].slice(0, 50);
  if (keys.length === 0) return [];

  const conditions: SQL[] = [
    app_offer_condition(input.workspace_id),
    not_a_model_credential_app,
    or(
      inArray(normalized_app_column(apps.app_name), keys),
      inArray(normalized_app_column(apps.app_key), keys),
      inArray(normalized_app_column(apps.app_display_name), keys),
    ) as SQL,
  ];
  if (input.workspace_id) conditions.push(app_visibility_condition(input.workspace_id));

  return db.query.apps.findMany({
    where: and(...conditions),
    orderBy: (table, { asc }) => [
      sql`case when ${table.app_status} = 'active' then 0 else 1 end`,
      asc(table.app_name),
    ],
  });
}

function composio_toolkit_slug_condition(toolkit_slugs: readonly string[]): SQL {
  return and(
    sql`apps.metadata->'sourced_from'->>'provider' = 'composio'`,
    inArray(sql<string>`lower(apps.metadata->'sourced_from'->>'provider_app_slug')`, toolkit_slugs),
  ) as SQL;
}

export async function list_offered_apps_by_composio_toolkit_slugs(
  db: Database,
  input: { toolkit_slugs: string[]; workspace_id?: string | undefined },
) {
  const toolkit_slugs = [...new Set(input.toolkit_slugs.map((slug) => slug.toLowerCase()))];
  if (toolkit_slugs.length === 0) return [];

  const conditions: SQL[] = [
    app_offer_condition(input.workspace_id),
    not_a_model_credential_app,
    composio_toolkit_slug_condition(toolkit_slugs),
  ];
  if (input.workspace_id) conditions.push(app_visibility_condition(input.workspace_id));

  return db.query.apps.findMany({
    where: and(...conditions),
    orderBy: (table, { asc }) => [asc(table.app_name)],
  });
}

export async function list_catalog_rows_by_composio_toolkit_slugs(
  db: Database,
  input: { toolkit_slugs: string[] },
) {
  const toolkit_slugs = [...new Set(input.toolkit_slugs.map((slug) => slug.toLowerCase()))];
  if (toolkit_slugs.length === 0) return [];

  return db.query.apps.findMany({
    where: and(eq(apps.app_status, 'active'), composio_toolkit_slug_condition(toolkit_slugs)),
    orderBy: (table, { asc }) => [asc(table.app_name)],
  });
}

export async function get_app_by_name(
  db: Database,
  input: { workspace_id?: string | undefined; app_name: string },
) {
  const conditions: SQL[] = [
    eq(apps.app_name, input.app_name),
    app_offer_condition(input.workspace_id),
    not_a_model_credential_app,
  ];
  if (input.workspace_id) conditions.push(app_visibility_condition(input.workspace_id));

  return (
    (await db.query.apps.findFirst({
      where: and(...conditions),
      orderBy: app_scope_precedence(input.workspace_id),
    })) ?? null
  );
}

export async function get_composio_app_by_toolkit(
  db: Database,
  input: { workspace_id?: string | undefined; toolkit_slug: string },
) {
  const conditions: SQL[] = [
    sql`${apps.metadata}->'sourced_from'->>'provider' = 'composio'`,
    sql`${apps.metadata}->'sourced_from'->>'provider_app_slug' = ${input.toolkit_slug}`,
    app_offer_condition(input.workspace_id),
    not_a_model_credential_app,
  ];
  if (input.workspace_id) conditions.push(app_visibility_condition(input.workspace_id));

  return (
    (await db.query.apps.findFirst({
      where: and(...conditions),
      orderBy: app_scope_precedence(input.workspace_id),
    })) ?? null
  );
}

export async function count_app_tools(db: Database, app_id: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nodes)
    .where(
      and(
        eq(nodes.app_id, app_id),
        eq(nodes.node_status, 'active'),
        ne(nodes.node_kind, 'trigger'),
      ),
    );
  return row?.count ?? 0;
}

export async function search_apps(
  db: Database,
  input: {
    workspace_id?: string | undefined;
    query?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    cursor?: string | undefined;
  },
) {
  const limit = clamp_integer(input.limit ?? 40, 1, 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const conditions = app_search_conditions(input.workspace_id, input.query);
  const cursor = input.cursor ? parse_app_cursor(input.cursor) : null;
  const page_conditions = cursor ? [...conditions, app_cursor_condition(cursor)] : conditions;
  const page_where = page_conditions.length > 0 ? and(...page_conditions) : undefined;
  const count_where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, total_rows] = await Promise.all([
    db
      .select()
      .from(apps)
      .where(page_where)
      .orderBy(asc(apps.app_name), asc(apps.app_id))
      .limit(limit + 1)
      .offset(cursor ? 0 : offset),
    db.select({ total: sql<number>`count(*)::int` }).from(apps).where(count_where),
  ]);
  const items = rows.slice(0, limit);

  return {
    items,
    total: total_rows[0]?.total ?? 0,
    limit,
    offset: cursor ? 0 : offset,
    next_cursor: rows.length > limit ? build_app_cursor(items[items.length - 1]) : null,
  };
}

const list_nodes_default_limit = 200;
const list_nodes_max_limit = 500;

export async function list_nodes(
  db: Database,
  input: { workspace_id?: string; keys?: string[]; limit?: number } = {},
) {
  const conditions: SQL[] = [node_app_offer_condition(input.workspace_id)];
  if (input.workspace_id) conditions.push(node_visibility_condition(input.workspace_id));

  if (input.keys && input.keys.length > 0) {
    const keys = input.keys.slice(0, list_nodes_max_limit);
    return db.query.nodes.findMany({
      where: and(inArray(nodes.node_key, keys), ...conditions),
      orderBy: (table, { asc }) => [asc(table.node_name)],
    });
  }

  const limit = clamp_integer(input.limit ?? list_nodes_default_limit, 1, list_nodes_max_limit);
  return db.query.nodes.findMany({
    where: and(...conditions),
    orderBy: (table, { asc }) => [asc(table.node_name)],
    limit,
  });
}

export async function list_app_nodes(
  db: Database,
  input: { workspace_id: string; app_id: string },
) {
  return db.query.nodes.findMany({
    where: and(
      eq(nodes.app_id, input.app_id),
      node_visibility_condition(input.workspace_id),
      node_app_offer_condition(input.workspace_id),
      inArray(nodes.node_status, ['active', 'deprecated']),
      inArray(nodes.discovery_status, ['visible', settings_only_discovery_status]),
    ),
    orderBy: (table, { asc }) => [asc(table.node_display_name), asc(table.node_name)],
    limit: list_nodes_max_limit,
  });
}

export async function count_visible_nodes_by_app(
  db: Database,
  input: { workspace_id: string; app_ids: string[] },
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (input.app_ids.length === 0) return counts;

  const rows = await db
    .select({ app_id: nodes.app_id, count: sql<number>`count(*)::int` })
    .from(nodes)
    .where(
      and(
        inArray(nodes.app_id, input.app_ids),
        node_visibility_condition(input.workspace_id),
        inArray(nodes.node_status, ['active', 'deprecated']),
        eq(nodes.discovery_status, 'visible'),
      ),
    )
    .groupBy(nodes.app_id);

  for (const row of rows) counts.set(row.app_id, row.count);
  return counts;
}

export async function search_tool_catalog(
  db: Database,
  input: {
    workspace_id?: string;
    query: string;
    app_name?: string;
    limit?: number;
    offset?: number;
  },
) {
  const trimmed_query = input.query.trim();
  if (!trimmed_query) return [];

  const search_terms = extract_catalog_search_terms(trimmed_query);
  const ranking_term_groups = catalog_ranking_term_groups(search_terms, input.app_name);
  const ranking_terms = [...new Set(ranking_term_groups.flat())];
  const limit = clamp_integer(input.limit ?? 50, 1, 51);
  const offset = Math.max(input.offset ?? 0, 0);
  const conditions: SQL[] = [
    inArray(nodes.node_status, ['active', 'deprecated']),
    eq(nodes.discovery_status, 'visible'),
    app_offer_condition(input.workspace_id),
  ];
  if (input.workspace_id) conditions.push(node_visibility_condition(input.workspace_id));
  if (input.app_name) conditions.push(eq(apps.app_name, input.app_name));

  const filter_terms = input.app_name ? ranking_terms : search_terms;
  const term_conditions = filter_terms.map(catalog_search_term_condition);
  const selected_term_condition = await select_catalog_term_condition(
    db,
    conditions,
    term_conditions,
    input.app_name !== undefined,
  );

  return db
    .select(catalog_tool_columns)
    .from(nodes)
    .innerJoin(apps, eq(nodes.app_id, apps.app_id))
    .where(and(...conditions, selected_term_condition))
    .orderBy(
      ...ranking_term_groups.map(catalog_search_rank_for_terms),
      apps.app_name,
      nodes.node_name,
    )
    .limit(limit)
    .offset(offset);
}

async function select_catalog_term_condition(
  db: Database,
  conditions: SQL[],
  term_conditions: SQL[],
  app_is_selected: boolean,
) {
  if (term_conditions.length === 0) return undefined;
  if (app_is_selected || term_conditions.length === 1) return or(...term_conditions);
  return (await catalog_has_match_for_all_terms(db, conditions, term_conditions))
    ? and(...term_conditions)
    : or(...term_conditions);
}

async function catalog_has_match_for_all_terms(
  db: Database,
  conditions: SQL[],
  term_conditions: SQL[],
) {
  const [match] = await db
    .select({ node_id: nodes.node_id })
    .from(nodes)
    .innerJoin(apps, eq(nodes.app_id, apps.app_id))
    .where(and(...conditions, ...term_conditions))
    .limit(1);
  return match !== undefined;
}

export async function list_catalog_api_fallback_tools(
  db: Database,
  input: { workspace_id?: string; app_names: string[]; limit?: number },
) {
  const app_names = [...new Set(input.app_names.filter(Boolean))];
  if (app_names.length === 0) return [];
  const conditions: SQL[] = [
    inArray(apps.app_name, app_names),
    inArray(nodes.node_status, ['active', 'deprecated']),
    eq(nodes.discovery_status, 'visible'),
    inArray(nodes.runtime_handler, [...api_proxy_runtime_handlers]),
    app_offer_condition(input.workspace_id),
  ];
  if (input.workspace_id) conditions.push(node_visibility_condition(input.workspace_id));

  return db
    .select(catalog_tool_columns)
    .from(nodes)
    .innerJoin(apps, eq(nodes.app_id, apps.app_id))
    .where(and(...conditions))
    .orderBy(apps.app_name, nodes.node_name)
    .limit(clamp_integer(input.limit ?? 10, 1, 20));
}

export type CatalogToolRow = Awaited<ReturnType<typeof search_tool_catalog>>[number];

export type CatalogToolResolution = {
  tool: CatalogToolRow;
  connection: typeof connections.$inferSelect | null;
  compatibility: ReturnType<typeof validate_node_execution_compatibility>;
  access_denied: boolean;
};

export async function resolve_catalog_tools(
  db: Database,
  input: {
    workspace_id: string;
    tools: CatalogToolRow[];
    participants?: Participants;
    room_private_to?: string | null | undefined;
  },
): Promise<CatalogToolResolution[]> {
  const tools_with_connections = input.tools.filter((tool) => tool.connection_profile_key !== null);
  if (tools_with_connections.length === 0) {
    return input.tools.map((tool) => build_catalog_tool_resolution(tool, []));
  }

  const app_ids = [...new Set(tools_with_connections.map((tool) => tool.app_id))];
  const active_connections = await db.query.connections.findMany({
    where: and(
      eq(connections.workspace_id, input.workspace_id),
      eq(connections.connection_status, 'active'),
      inArray(connections.app_id, app_ids),
    ),
    orderBy: (table, { desc }) => [desc(table.created_time)],
  });
  const grants_by_connection = await list_grants_for_resources(db, {
    workspace_id: input.workspace_id,
    resource_type: 'connection',
    resource_ids: active_connections.map((connection) => connection.connection_id),
  });
  const candidates_by_tool = group_connections_by_tool(active_connections);
  return input.tools.map((tool) => {
    const candidates = candidates_by_tool.get(connection_match_key(tool)) ?? [];
    return build_catalog_tool_resolution(tool, candidates, grants_by_connection, input);
  });
}

export async function get_tool_catalog_entry(
  db: DatabaseExecutor,
  input: {
    node_key: string;
    workspace_id?: string;
    node_statuses?: string[];
    discovery_status?: string;
  },
) {
  if (!input.node_key) return null;

  const conditions: SQL[] = [
    eq(nodes.node_key, input.node_key),
    inArray(nodes.node_status, input.node_statuses ?? ['active']),
  ];
  if (input.workspace_id) conditions.push(node_visibility_condition(input.workspace_id));
  if (input.discovery_status) conditions.push(eq(nodes.discovery_status, input.discovery_status));

  const [entry] = await db
    .select(catalog_tool_columns)
    .from(nodes)
    .innerJoin(apps, eq(nodes.app_id, apps.app_id))
    .where(and(...conditions))
    .orderBy(scope_precedence(input.workspace_id))
    .limit(1);

  return entry ?? null;
}

export async function get_catalog_node_identity(
  db: Database,
  input: { workspace_id: string; node_key: string },
) {
  const [identity] = await db
    .select({
      node_id: nodes.node_id,
      node_version: nodes.node_version,
      node_config: nodes.node_config,
    })
    .from(nodes)
    .where(
      and(
        eq(nodes.node_key, input.node_key),
        inArray(nodes.node_status, ['active', 'deprecated']),
        node_visibility_condition(input.workspace_id),
      ),
    )
    .orderBy(scope_precedence(input.workspace_id))
    .limit(1);
  return identity ?? null;
}

export async function get_visible_tool_catalog_entry(
  db: Database,
  input: {
    workspace_id: string;
    node_key: string;
    node_statuses?: string[];
  },
) {
  return get_tool_catalog_entry(db, {
    workspace_id: input.workspace_id,
    node_key: input.node_key,
    node_statuses: input.node_statuses ?? ['active', 'deprecated'],
    discovery_status: 'visible',
  });
}

export async function resolve_catalog_tool(
  db: Database,
  input: {
    workspace_id: string;
    node_key: string;
    connection_id?: string;
    participants?: Participants;
    room_private_to?: string | null | undefined;
  },
) {
  const tool = await get_visible_tool_catalog_entry(db, {
    workspace_id: input.workspace_id,
    node_key: input.node_key,
    node_statuses: ['active', 'deprecated', 'retired'],
  });
  const matching = tool
    ? await find_matching_active_tool_connection(db, {
        workspace_id: input.workspace_id,
        app_id: tool.app_id,
        tool,
        ...(input.connection_id ? { connection_id: input.connection_id } : {}),
        ...(input.participants ? { participants: input.participants } : {}),
        room_private_to: input.room_private_to,
      })
    : null;
  const selected_connection = matching?.connection ?? null;
  const connection_selector = tool?.connection_profile_key
    ? ({ strategy: 'latest_active_matching_connection' } as const)
    : ({ strategy: 'no_connection_required' } as const);
  const compatibility = validate_node_execution_compatibility(
    tool,
    selected_connection,
    connection_selector,
  );

  return {
    tool,
    connection: selected_connection,
    compatibility,
    access_denied: matching?.access_denied ?? false,
  };
}

const catalog_tool_columns = {
  app_id: apps.app_id,
  app_name: apps.app_name,
  app_key: apps.app_key,
  app_catalog_scope: apps.catalog_scope,
  app_workspace_id: apps.workspace_id,
  app_display_name: apps.app_display_name,
  allowed_request_origins: apps.allowed_request_origins,
  app_category: apps.app_category,
  auth_type: apps.auth_type,
  node_id: nodes.node_id,
  node_name: nodes.node_name,
  catalog_scope: nodes.catalog_scope,
  workspace_id: nodes.workspace_id,
  node_key: nodes.node_key,
  node_version: nodes.node_version,
  node_display_name: nodes.node_display_name,
  node_kind: nodes.node_kind,
  input_schema: nodes.input_schema,
  output_schema: nodes.output_schema,
  approval_policy: nodes.approval_policy,
  runtime_handler: nodes.runtime_handler,
  node_runtime: nodes.node_runtime,
  node_status: nodes.node_status,
  discovery_status: nodes.discovery_status,
  successor_node_key: nodes.successor_node_key,
  provider_key: nodes.provider_key,
  provider_config_key: nodes.provider_config_key,
  provider_config_version: nodes.provider_config_version,
  connection_profile_key: nodes.connection_profile_key,
  connection_profile_version: nodes.connection_profile_version,
  required_scopes: nodes.required_scopes,
  required_account_properties: nodes.required_account_properties,
  node_config: nodes.node_config,
  metadata: nodes.metadata,
};

const catalog_search_stop_words = new Set([
  'a',
  'about',
  'all',
  'and',
  'any',
  'are',
  'available',
  'can',
  'connected',
  'connection',
  'connections',
  'do',
  'does',
  'for',
  'got',
  'has',
  'have',
  'integration',
  'integrations',
  'is',
  'me',
  'now',
  'of',
  'or',
  'the',
  'tool',
  'tools',
  'with',
  'you',
]);

function extract_catalog_search_terms(query: string) {
  const terms = query
    .toLowerCase()
    .match(/[a-z0-9_/-]+/g)
    ?.map((term) => term.trim())
    .filter((term) => term.length > 1 && !catalog_search_stop_words.has(term));
  const unique_terms = [...new Set(terms ?? [])].slice(0, 6);
  return unique_terms.length > 0 ? unique_terms : [query];
}

const catalog_operation_term_groups = [
  ['fetch', 'find', 'get', 'list', 'lookup', 'read', 'retrieve', 'search'],
  ['add', 'create', 'insert', 'post'],
  ['edit', 'modify', 'patch', 'put', 'update', 'upsert'],
  ['delete', 'remove'],
];

function catalog_ranking_term_groups(search_terms: string[], app_name: string | undefined) {
  if (!app_name) return search_terms.map((term) => [term]);
  const app_terms = new Set([app_name.toLowerCase(), ...app_name.toLowerCase().split(/[_/-]+/)]);
  const operation_groups = new Set<string[]>();
  const groups = search_terms
    .filter((term) => !app_terms.has(term))
    .flatMap((term) => {
      const operation_group = catalog_operation_term_groups.find((group) => group.includes(term));
      if (!operation_group || operation_groups.has(operation_group)) return [[term]];
      operation_groups.add(operation_group);
      return [operation_group];
    });
  return groups.length > 0 ? groups : [search_terms];
}

function catalog_search_term_condition(term: string) {
  const pattern = `%${term}%`;
  return sql`(${apps.app_name} ILIKE ${pattern}
    OR ${apps.app_display_name} ILIKE ${pattern}
    OR ${nodes.node_name} ILIKE ${pattern}
    OR ${nodes.node_display_name} ILIKE ${pattern}
    OR ${nodes.node_key} ILIKE ${pattern}
    OR ${nodes.runtime_handler} ILIKE ${pattern})`;
}

function catalog_search_rank(term: string) {
  const pattern = `%${term}%`;
  return sql<number>`case
    when lower(${apps.app_name}) = lower(${term}) then 0
    when lower(${apps.app_display_name}) = lower(${term}) then 1
    when lower(${nodes.node_name}) = lower(${term}) then 2
    when lower(${nodes.node_display_name}) = lower(${term}) then 3
    when ${nodes.node_name} ILIKE ${pattern} then 4
    when ${nodes.node_display_name} ILIKE ${pattern} then 5
    when ${nodes.node_key} ILIKE ${pattern} then 6
    else 8
  end`;
}

function catalog_search_rank_for_terms(terms: string[]) {
  const [first_rank, ...remaining_ranks] = terms.map(catalog_search_rank);
  if (!first_rank) return sql<number>`8`;
  if (remaining_ranks.length === 0) return first_rank;
  return sql<number>`least(${sql.join([first_rank, ...remaining_ranks], sql`, `)})`;
}

async function find_matching_active_tool_connection(
  db: Database,
  input: {
    workspace_id: string;
    app_id: string;
    tool: {
      provider_key: string | null;
      provider_config_key: string | null;
      provider_config_version: number | null;
      connection_profile_key: string | null;
      connection_profile_version: number | null;
    };
    connection_id?: string;
    participants?: Participants;
    room_private_to?: string | null | undefined;
  },
) {
  if (input.tool.connection_profile_key === null) return null;

  const exact_match_conditions = [
    eq(connections.workspace_id, input.workspace_id),
    eq(connections.app_id, input.app_id),
    eq(connections.connection_status, 'active'),
    eq(connections.provider_key, input.tool.provider_key ?? ''),
    eq(connections.provider_config_key, input.tool.provider_config_key ?? ''),
    eq(connections.provider_config_version, input.tool.provider_config_version ?? 0),
    eq(connections.connection_profile_key, input.tool.connection_profile_key),
    eq(connections.connection_profile_version, input.tool.connection_profile_version ?? 0),
    ...(input.connection_id ? [eq(connections.connection_id, input.connection_id)] : []),
  ];

  const candidates = await db.query.connections.findMany({
    where: and(...exact_match_conditions),
    orderBy: (table, { desc }) => [desc(table.created_time)],
  });
  if (candidates.length === 0) return { connection: null, access_denied: false };

  const grants_by_connection = await list_grants_for_resources(db, {
    workspace_id: input.workspace_id,
    resource_type: 'connection',
    resource_ids: candidates.map((connection) => connection.connection_id),
  });
  return select_accessible_connection(candidates, grants_by_connection, input);
}

function build_catalog_tool_resolution(
  tool: CatalogToolRow,
  candidates: (typeof connections.$inferSelect)[],
  grants_by_connection: Map<string, ResourceGrantRow[]> = new Map(),
  gathering: CatalogGathering = {},
): CatalogToolResolution {
  const matching =
    tool.connection_profile_key === null
      ? null
      : select_accessible_connection(candidates, grants_by_connection, gathering);
  const selected_connection = matching?.connection ?? null;
  const connection_selector = tool.connection_profile_key
    ? ({ strategy: 'latest_active_matching_connection' } as const)
    : ({ strategy: 'no_connection_required' } as const);

  return {
    tool,
    connection: selected_connection,
    compatibility: validate_node_execution_compatibility(
      tool,
      selected_connection,
      connection_selector,
    ),
    access_denied: matching?.access_denied ?? false,
  };
}

function group_connections_by_tool(active_connections: (typeof connections.$inferSelect)[]) {
  const candidates_by_tool = new Map<string, (typeof connections.$inferSelect)[]>();
  for (const connection of active_connections) {
    const key = connection_match_key(connection);
    const candidates = candidates_by_tool.get(key) ?? [];
    candidates.push(connection);
    candidates_by_tool.set(key, candidates);
  }
  return candidates_by_tool;
}

function connection_match_key(input: {
  app_id: string;
  provider_key: string | null;
  provider_config_key: string | null;
  provider_config_version: number | null;
  connection_profile_key: string | null;
  connection_profile_version: number | null;
}) {
  return JSON.stringify([
    input.app_id,
    input.provider_key ?? '',
    input.provider_config_key ?? '',
    input.provider_config_version ?? 0,
    input.connection_profile_key,
    input.connection_profile_version ?? 0,
  ]);
}

type CatalogGathering = {
  participants?: Participants;
  room_private_to?: string | null | undefined;
};

function select_accessible_connection(
  candidates: (typeof connections.$inferSelect)[],
  grants_by_connection: Map<string, ResourceGrantRow[]> = new Map(),
  gathering: CatalogGathering = {},
) {
  if (candidates.length === 0) return { connection: null, access_denied: false };

  const accessible = candidates.find((connection) =>
    connection_is_accessible_to_participants(
      grants_by_connection.get(connection.connection_id) ?? [],
      gathering,
      connection.connected_by,
    ),
  );
  if (accessible) return { connection: accessible, access_denied: false };

  return { connection: null, access_denied: true };
}

function connection_is_accessible_to_participants(
  grants: readonly ResourceGrantRow[],
  gathering: CatalogGathering,
  owner_user_id?: string | null,
) {
  if (grants.length === 0) return true;
  return may_use_resource({
    default_access: resource_type_definitions.connection.default_access,
    grants: read_grant_rules(grants),
    participants: gathering.participants ?? empty_participants,
    owner_user_id,
    room_private_to: gathering.room_private_to,
  }).allowed;
}

export function app_visibility_condition(workspace_id: string): SQL {
  return or(
    and(eq(apps.catalog_scope, 'global'), isNull(apps.workspace_id)),
    and(eq(apps.catalog_scope, 'workspace'), eq(apps.workspace_id, workspace_id)),
  ) as SQL;
}

function scope_precedence(workspace_id: string | undefined) {
  return workspace_id
    ? sql`CASE WHEN ${nodes.catalog_scope} = 'workspace' AND ${nodes.workspace_id} = ${workspace_id} THEN 0 ELSE 1 END`
    : sql`CASE WHEN ${nodes.catalog_scope} = 'global' THEN 0 ELSE 1 END`;
}

export function app_scope_precedence(workspace_id: string | undefined) {
  return workspace_id
    ? sql`CASE WHEN ${apps.catalog_scope} = 'workspace' AND ${apps.workspace_id} = ${workspace_id} THEN 0 ELSE 1 END`
    : sql`CASE WHEN ${apps.catalog_scope} = 'global' THEN 0 ELSE 1 END`;
}

function normalized_app_column(
  column: typeof apps.app_name | typeof apps.app_key | typeof apps.app_display_name,
) {
  return sql<string>`regexp_replace(lower(${column}), '[^a-z0-9]', '', 'g')`;
}

function normalize_catalog_key(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function app_search_conditions(workspace_id: string | undefined, query: string | undefined) {
  const conditions: SQL[] = [
    app_offer_condition(workspace_id),
    not_a_model_credential_app,
    workspace_id
      ? app_visibility_condition(workspace_id)
      : (and(eq(apps.catalog_scope, 'global'), isNull(apps.workspace_id)) as SQL),
  ];

  const trimmed_query = query?.trim();
  if (trimmed_query) {
    const pattern = `%${trimmed_query}%`;
    conditions.push(sql`(${apps.app_name} ILIKE ${pattern}
      OR ${apps.app_display_name} ILIKE ${pattern}
      OR ${apps.app_category} ILIKE ${pattern}
      OR ${apps.auth_type} ILIKE ${pattern}
      OR ${apps.metadata}::text ILIKE ${pattern}
      OR ${apps.display_config}::text ILIKE ${pattern})`);
  }

  return conditions;
}

export function node_visibility_condition(workspace_id: string): SQL {
  return or(
    and(eq(nodes.catalog_scope, 'global'), isNull(nodes.workspace_id)),
    and(eq(nodes.catalog_scope, 'workspace'), eq(nodes.workspace_id, workspace_id)),
  ) as SQL;
}

function clamp_integer(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function app_cursor_condition(cursor: { app_name: string; app_id: string }) {
  return sql`(${apps.app_name} > ${cursor.app_name}
    OR (${apps.app_name} = ${cursor.app_name} AND ${apps.app_id} > ${cursor.app_id}))`;
}

function build_app_cursor(app: typeof apps.$inferSelect | undefined) {
  if (!app) return null;
  return Buffer.from(JSON.stringify({ app_name: app.app_name, app_id: app.app_id })).toString(
    'base64url',
  );
}

function parse_app_cursor(cursor: string) {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Cursor must be an object');
    }
    const cursor_fields = value as { app_name?: unknown; app_id?: unknown };
    const app_name =
      typeof cursor_fields.app_name === 'string' ? cursor_fields.app_name.trim() : '';
    const app_id = typeof cursor_fields.app_id === 'string' ? cursor_fields.app_id.trim() : '';
    if (!app_name || !app_id) throw new Error('Cursor is missing app_name or app_id');
    return { app_name, app_id };
  } catch (error) {
    throw new ValidationError('App search cursor is invalid', {
      message: format_error_message(error, 'Invalid cursor'),
    });
  }
}

export async function list_connected_app_names(db: Database, workspace_id: string) {
  const rows = await db
    .selectDistinct({
      app_name: apps.app_name,
      provider_key: connections.provider_key,
      provider_config_key: connections.provider_config_key,
    })
    .from(connections)
    .leftJoin(apps, eq(apps.app_id, connections.app_id))
    .where(
      and(eq(connections.workspace_id, workspace_id), eq(connections.connection_status, 'active')),
    );
  const app_names = new Set<string>();
  for (const row of rows) {
    if (row.app_name) app_names.add(row.app_name);
    else if (row.provider_key === 'native') {
      const native_app_name = row.provider_config_key.split(':')[1];
      if (native_app_name) app_names.add(native_app_name);
    }
  }
  return [...app_names];
}
