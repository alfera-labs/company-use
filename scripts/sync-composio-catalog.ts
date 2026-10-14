// Imports the Composio catalog into the apps/nodes catalog the runtime reads. A one-shot admin
// tool: nothing schedules it, nothing in the API calls it, and re-running it is safe.
//
//   bun run catalog:plan local                            # plan only (the default is a dry run)
//   bun run catalog:plan local --toolkit attio            # plan for one toolkit
//   bun run catalog:apply local                           # apply the plan you just read
//
// The plan is decided first (plan_composio_catalog_migration), printed, and only then applied.
// Without `--confirm` the script prints the plan and exits, so the preview is not optional. Every
// write goes through core/db/queries/composio_catalog_writes.ts; this file fetches, plans, logs,
// and counts.

import { env } from '@coworker/config';
import { get_all_connector_apps } from '@coworker/connectors';
import { close_database, get_database } from '@coworker/core/db/connection';
import {
  read_composio_nodes_by_app,
  read_global_app_ids_by_name,
  upsert_composio_app,
  upsert_composio_nodes,
} from '@coworker/core/db/queries/composio_catalog_writes';
import { list_provider_app_usage } from '@coworker/core/db/queries/provider_app_usage';
import type {
  ComposioTool,
  ComposioToolkitDetail,
  ComposioTriggerType,
} from '@coworker/core/integrations/composio_api_records';
import {
  build_composio_action_node_seed,
  build_composio_app_seed,
  build_composio_proxy_node_seeds,
  build_composio_trigger_node_seed,
  type ComposioNodeSeed,
  composio_node_name,
} from '@coworker/core/integrations/composio_catalog';
import {
  type ComposioCatalogPlan,
  type ComposioToolkitAction,
  plan_composio_catalog_migration,
} from '@coworker/core/integrations/composio_catalog_plan';
import { composio_provider_key } from '@coworker/core/integrations/composio_schema';
import {
  append_hash_suffix,
  type ExistingProviderNodeIdentity,
} from '@coworker/core/integrations/provider_catalog_identity';
import {
  catalog_app_name_max_length,
  catalog_node_version_maximum,
  maximum_node_name_length,
  normalize_machine_name,
} from '@coworker/shared';
import { create_composio_client } from '@runtime-platform/composio/composio_client';
import { get_all_tools } from '@runtime-platform/tools/tool_registry';
import {
  add_field_choices_for_toolkit,
  can_ask_for_field_choices,
} from '@scripts/lib/catalog_field_choices';
import {
  read_all_flags,
  read_optional_int,
  run_with_concurrency,
} from '@scripts/lib/catalog_sync_helpers';

const actor_id = 'system:composio_catalog_sync';
// One screenful of each plan table is enough to see what the run will do; the counters above it
// carry the totals.
const plan_preview_row_limit = 30;
// A 1540-toolkit run prints one of these per 25 toolkits, so an operator watching the log can see
// it moving without reading 1540 lines.
const progress_interval = 25;

const args = process.argv.slice(2);
const toolkit_filters = read_all_flags(args, '--toolkit');
const max_toolkits = read_optional_int(args, '--max-toolkits');
// How many provider reads run at once: the toolkit detail fan-out, which is one call per toolkit
// because `auth_config_details` lives nowhere else.
const concurrency = read_optional_int(args, '--concurrency') ?? 12;
// How many toolkit write transactions run at once. Each one holds a connection, so keep it under
// DATABASE_POOL_MAX (10 by default).
const db_concurrency = read_optional_int(args, '--db-concurrency') ?? 6;
// `--delay` paced the old toolkit-by-toolkit loop. Retry with backoff inside the client replaces
// it, so the flag is read and ignored rather than removed: a documented invocation still runs.
const ignored_delay_ms = read_optional_int(args, '--delay');
// Writes need an explicit `--confirm`. `--dry-run` is accepted so an operator can say what they
// mean, but it is also what happens when nothing is said.
const confirm = args.includes('--confirm');
const dry_run = !confirm || args.includes('--dry-run');
const skip_triggers = !args.includes('--with-triggers');
// Which trigger boxes can be filled from the account is worked out by a quick model per app, and
// reused while nothing changed. `--skip-field-choices`, or no model credential, keeps what was stored.
const ask_for_field_choices = can_ask_for_field_choices(args);

const composio_api_key = env.COMPOSIO_API_KEY;
if (!composio_api_key) throw new Error('Missing required env var: COMPOSIO_API_KEY');

const api = create_composio_client({
  api_key: composio_api_key,
  // The client already waited and tried again. This is only so a run that hit a rate limit says so
  // instead of just looking slow.
  on_retry: (notice) => {
    counters.retries += 1;
    log_event('retry', {
      path: notice.path,
      status: notice.status,
      attempt: notice.attempt,
      delay_ms: Math.round(notice.delay_ms),
    });
  },
});

type ToolkitSyncResult = {
  app_inserted: boolean;
  node_count: number;
  nodes_created: number;
  nodes_updated: number;
  nodes_deleted: number;
  empty_toolkit_refused: boolean;
  inactive_connection_profile: {
    connection_profile_key: string;
    disabled_reason: string | null;
  } | null;
};

// Everything the write phase reads, fetched once before it starts. No per-toolkit loop reaches
// back out to the provider.
type ToolkitCatalog = {
  detail_by_slug: Map<string, ComposioToolkitDetail>;
  detail_error_by_slug: Map<string, Error>;
  tools_by_slug: Map<string, ComposioTool[]>;
  triggers_by_slug: Map<string, ComposioTriggerType[]>;
};

const counters = {
  apps_created: 0,
  apps_updated: 0,
  nodes_created: 0,
  nodes_updated: 0,
  nodes_deleted: 0,
  failed_toolkits: 0,
  toolkits_empty: 0,
  retries: 0,
};

function log_event(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event: `composio_catalog.${event}`, ...fields }));
}

async function main() {
  const started = Date.now();
  const composio_apps = await list_provider_app_usage(get_database(), {
    provider_key: composio_provider_key,
  });
  // The plan is decided against the whole toolkit list even when the run syncs part of it. An
  // app_name that a toolkit outside the selection owns has to stay reserved, so `--toolkit`
  // narrows what gets written and nothing else.
  const toolkits = await api.list_toolkits();
  const plan = plan_composio_catalog_migration({
    toolkits,
    composio_apps,
    reserved_app_names: build_reserved_app_names(composio_apps),
  });
  const toolkit_actions = select_toolkit_actions(plan.toolkit_actions);
  log_plan(plan, toolkit_actions);
  print_plan_summary(toolkit_actions);

  if (dry_run) {
    log_event('dry_run', {
      message: 'No rows were written. Re-run with --confirm to apply the plan above.',
    });
  } else {
    const catalog = await fetch_toolkit_catalog(toolkit_actions);
    await write_toolkits({ actions: toolkit_actions, catalog, started });
    print_applied_counters(started);
  }

  log_event('complete', { ...counters, duration_ms: Date.now() - started });
}

// The database this run targets, host and name only. Never the password.
function read_database_label() {
  try {
    const url = new URL(env.DATABASE_URL);
    return `${url.hostname}/${url.pathname.slice(1)}`;
  } catch {
    return 'unknown database';
  }
}

// The JSON events above are for machines. This block is for the operator who has to decide
// whether to apply the plan, so every action reads as a sentence about rows.
function print_plan_summary(toolkit_actions: ComposioToolkitAction[]) {
  const rows: Array<[string, number, string]> = [
    [
      'triggers_only',
      toolkit_actions.filter((action) => action.triggers_only).length,
      'native toolkit; trigger nodes only, no tool nodes',
    ],
    ['create', count_actions(toolkit_actions, 'create'), 'new Composio app'],
    [
      'update_composio',
      count_actions(toolkit_actions, 'update_composio'),
      'Composio app already present',
    ],
  ];

  console.log(`Composio catalog plan (${read_database_label()})`);
  for (const [label, count, explanation] of rows) {
    console.log(`  ${label.padEnd(18)}: ${count}   (${explanation})`);
  }
  if (dry_run) {
    console.log('Dry run: nothing written. Apply with: bun run catalog:apply <env>');
  }
}

function print_applied_counters(started: number) {
  console.log(`Applied (${read_database_label()})`);
  for (const [label, count] of Object.entries(counters)) {
    console.log(`  ${label.padEnd(18)}: ${count}`);
  }
  console.log(`  ${'elapsed'.padEnd(18)}: ${format_elapsed(Date.now() - started)}`);
}

function print_progress(completed: number, total: number, started: number) {
  const percent = total === 0 ? 100 : Math.round((completed / total) * 100);
  const nodes_written = format_count(counters.nodes_created + counters.nodes_updated);
  const elapsed = format_elapsed(Date.now() - started);
  console.log(
    `progress: ${completed}/${total} toolkits (${percent}%) | nodes written ${nodes_written} | elapsed ${elapsed}`,
  );
}

function format_elapsed(duration_ms: number) {
  const total_seconds = Math.round(duration_ms / 1000);
  const minutes = Math.floor(total_seconds / 60);
  return minutes > 0 ? `${minutes}m${total_seconds % 60}s` : `${total_seconds}s`;
}

function format_count(value: number) {
  return value.toLocaleString('en-US');
}

function log_plan(plan: ComposioCatalogPlan, toolkit_actions: ComposioToolkitAction[]) {
  log_event('plan', {
    toolkits: toolkit_actions.length,
    toolkits_in_catalog: plan.toolkit_actions.length,
    create: count_actions(toolkit_actions, 'create'),
    update_composio: count_actions(toolkit_actions, 'update_composio'),
    native_toolkits_triggers_only: plan.native_toolkits_triggers_only,
    concurrency,
    db_concurrency,
    // Kept in the event so a log from an old invocation still reads, and so the run says out loud
    // that the flag did nothing.
    delay_ms: ignored_delay_ms ?? 0,
    delay_ignored: ignored_delay_ms !== undefined,
    dry_run,
    skip_triggers,
  });
  log_event('plan_rows', { rows: toolkit_actions.slice(0, plan_preview_row_limit) });
}

function select_toolkit_actions(actions: ComposioToolkitAction[]) {
  const wanted = new Set(toolkit_filters);
  const selected =
    wanted.size > 0 ? actions.filter((action) => wanted.has(action.toolkit_slug)) : actions;
  return max_toolkits ? selected.slice(0, max_toolkits) : selected;
}

// Names no NEW Composio app may take: the native runtime tools, the native connectors, and every
// provider app row still on disk. A Composio row keeps its own name through the plan's
// `update_composio` action, so reserving it only stops a second toolkit from taking it.
function build_reserved_app_names(provider_apps: Array<{ app_name: string }>) {
  const native_tool_app_names = get_all_tools().map((tool) =>
    normalize_machine_name(tool.app_name, { maximum_length: catalog_app_name_max_length }),
  );
  return new Set([
    ...native_tool_app_names,
    ...get_all_connector_apps().map((app) => app.app_key),
    ...provider_apps.map((app) => app.app_name),
  ]);
}

function count_actions(actions: ComposioToolkitAction[], action: ComposioToolkitAction['action']) {
  return actions.filter((candidate) => candidate.action === action).length;
}

// The fetch phase. One bounded fan-out for the toolkit details, and one whole-catalog pass each
// for tools and trigger types: `/tools` without a toolkit filter carries `toolkit.slug` on every
// item, so 55 pages replace 1540 filtered calls. A run narrowed by `--toolkit` reads only those
// toolkits (the client decides), so a one-toolkit run stays a one-toolkit run.
async function fetch_toolkit_catalog(actions: ComposioToolkitAction[]): Promise<ToolkitCatalog> {
  const fetch_started = Date.now();
  const toolkit_slugs = actions.map((action) => action.toolkit_slug);
  const [details, tools, trigger_types] = await Promise.all([
    api.get_toolkits_detail(toolkit_slugs, { concurrency }),
    api.list_all_tools({ toolkit_slugs }),
    skip_triggers ? Promise.resolve([]) : api.list_all_trigger_types({ toolkit_slugs }),
  ]);

  const detail_by_slug = new Map<string, ComposioToolkitDetail>();
  const detail_error_by_slug = new Map<string, Error>();
  for (const detail of details) {
    if (detail.toolkit) detail_by_slug.set(detail.toolkit_slug, detail.toolkit);
    else detail_error_by_slug.set(detail.toolkit_slug, detail.error);
  }

  log_event('fetched', {
    toolkits: toolkit_slugs.length,
    toolkit_details: detail_by_slug.size,
    toolkit_details_failed: detail_error_by_slug.size,
    tools: tools.length,
    trigger_types: trigger_types.length,
    duration_ms: Date.now() - fetch_started,
  });

  return {
    detail_by_slug,
    detail_error_by_slug,
    tools_by_slug: group_by_toolkit_slug(tools),
    triggers_by_slug: group_by_toolkit_slug(trigger_types),
  };
}

function group_by_toolkit_slug<T extends { toolkit: { slug: string } }>(items: T[]) {
  const items_by_slug = new Map<string, T[]>();
  for (const item of items) {
    const bucket = items_by_slug.get(item.toolkit.slug);
    if (bucket) bucket.push(item);
    else items_by_slug.set(item.toolkit.slug, [item]);
  }
  return items_by_slug;
}

// The write phase. Nothing here calls the provider, so the only bound is the database pool.
async function write_toolkits(input: {
  actions: ComposioToolkitAction[];
  catalog: ToolkitCatalog;
  started: number;
}) {
  const { existing_nodes_by_app_id, app_ids_by_name } = await read_existing_nodes_by_app_id(
    input.actions,
  );
  let completed = 0;

  await run_with_concurrency(input.actions, db_concurrency, async (action) => {
    await write_one_toolkit({
      action,
      catalog: input.catalog,
      existing_nodes_by_app_id,
      existing_app_id: app_ids_by_name.get(action.app_name),
    });
    completed += 1;
    if (completed % progress_interval === 0) {
      print_progress(completed, input.actions.length, input.started);
    }
  });

  print_progress(input.actions.length, input.actions.length, input.started);
}

// Every Composio node the run may touch, read before the writes start: one statement per 500 apps
// instead of one read per toolkit.
async function read_existing_nodes_by_app_id(actions: ComposioToolkitAction[]) {
  const db = get_database();
  const app_ids_by_name = await read_global_app_ids_by_name(
    db,
    actions.map((action) => action.app_name),
  );
  const app_ids = [...new Set(app_ids_by_name.values())];
  return {
    existing_nodes_by_app_id: await read_composio_nodes_by_app(db, app_ids),
    app_ids_by_name,
  };
}

async function write_one_toolkit(input: {
  action: ComposioToolkitAction;
  catalog: ToolkitCatalog;
  existing_nodes_by_app_id: Map<string, ExistingProviderNodeIdentity[]>;
  existing_app_id: string | undefined;
}) {
  const { action, catalog } = input;
  const toolkit = catalog.detail_by_slug.get(action.toolkit_slug);
  if (!toolkit) {
    log_toolkit_failed(action, catalog.detail_error_by_slug.get(action.toolkit_slug));
    return;
  }

  try {
    const result = await sync_toolkit({
      action,
      toolkit,
      tools: catalog.tools_by_slug.get(action.toolkit_slug) ?? [],
      triggers: catalog.triggers_by_slug.get(action.toolkit_slug) ?? [],
      existing_nodes_by_app_id: input.existing_nodes_by_app_id,
      existing_app_id: input.existing_app_id,
    });
    count_toolkit_result(result);
    log_toolkit_result(action, result);
  } catch (error) {
    log_toolkit_failed(action, error);
  }
}

function log_toolkit_failed(action: ComposioToolkitAction, error: unknown) {
  counters.failed_toolkits += 1;
  console.error(
    JSON.stringify({
      event: 'composio_catalog.toolkit_failed',
      toolkit_slug: action.toolkit_slug,
      action: action.action,
      app_name: action.app_name,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

function count_toolkit_result(result: ToolkitSyncResult) {
  if (result.app_inserted) counters.apps_created += 1;
  else counters.apps_updated += 1;
  if (result.empty_toolkit_refused) counters.toolkits_empty += 1;
  counters.nodes_created += result.nodes_created;
  counters.nodes_updated += result.nodes_updated;
  counters.nodes_deleted += result.nodes_deleted;
}

function log_toolkit_result(action: ComposioToolkitAction, result: ToolkitSyncResult) {
  // A toolkit whose only OAuth app Composio does not host has no connectable profile yet. Its
  // nodes are still imported, pointing at the profile that works once an operator creates a
  // custom auth config, so the run has to say so rather than look complete.
  if (result.inactive_connection_profile) {
    log_event('no_active_profile', {
      app_name: action.app_name,
      ...result.inactive_connection_profile,
    });
  }
  // An empty answer from a toolkit that has an app row is a provider hiccup far more often than a
  // toolkit that lost every tool, so the nodes stay and the run says why.
  if (result.empty_toolkit_refused) {
    log_event('toolkit_empty', {
      toolkit_slug: action.toolkit_slug,
      app_name: action.app_name,
      message: 'Toolkit answered no tools, triggers, or proxy methods. Existing nodes were kept.',
    });
  }
  log_event('toolkit_synced', {
    toolkit_slug: action.toolkit_slug,
    action: action.action,
    app_name: action.app_name,
    node_count: result.node_count,
    nodes_created: result.nodes_created,
    nodes_updated: result.nodes_updated,
    nodes_deleted: result.nodes_deleted,
  });
}

// One transaction per toolkit: the app row, the nodes, and the
// deletion of the nodes the toolkit dropped all land together or not at all.
async function sync_toolkit(input: {
  action: ComposioToolkitAction;
  toolkit: ComposioToolkitDetail;
  tools: ComposioTool[];
  triggers: ComposioTriggerType[];
  existing_nodes_by_app_id: Map<string, ExistingProviderNodeIdentity[]>;
  existing_app_id: string | undefined;
}): Promise<ToolkitSyncResult> {
  const { action, toolkit } = input;
  const app_seed = build_composio_app_seed({ toolkit, app_name: action.app_name });
  const plain_node_seeds = build_node_seeds({
    toolkit,
    // A native-only toolkit contributes its trigger types and nothing else: the tools and the API
    // proxy stay with the native connector, so no `composio_slack` tool node is ever written.
    tools: action.triggers_only ? [] : input.tools,
    triggers: input.triggers,
    app_name: action.app_name,
    triggers_only: action.triggers_only ?? false,
  });
  // Before the transaction: a model call must never hold a database connection open.
  const node_seeds = await add_field_choices_for_toolkit({
    app_display_name: toolkit.name,
    node_seeds: plain_node_seeds,
    existing_node_configs: (input.existing_nodes_by_app_id.get(input.existing_app_id ?? '') ?? []).map(
      (node) => node.node_config,
    ),
    ask: ask_for_field_choices,
    log: log_event,
  });

  return get_database().transaction(async (tx) => {
    const app_row = await upsert_composio_app(tx, { app_seed, actor_id });
    const node_result = await upsert_composio_nodes(tx, {
      app_id: app_row.app_id,
      app_seed,
      node_seeds,
      actor_id,
      existing_nodes: input.existing_nodes_by_app_id.get(app_row.app_id) ?? [],
    });

    return {
      app_inserted: app_row.inserted,
      node_count: node_seeds.length,
      nodes_created: node_result.nodes_created,
      nodes_updated: node_result.nodes_updated,
      nodes_deleted: node_result.nodes_deleted,
      empty_toolkit_refused: node_result.empty_toolkit_refused,
      inactive_connection_profile: node_result.inactive_connection_profile,
    };
  });
}

function build_node_seeds(input: {
  toolkit: ComposioToolkitDetail;
  tools: ComposioTool[];
  triggers: ComposioTriggerType[];
  app_name: string;
  triggers_only?: boolean;
}): ComposioNodeSeed[] {
  const { toolkit, app_name } = input;
  const maximum_length = maximum_node_name_length(app_name, catalog_node_version_maximum);
  const proxy_seeds = input.triggers_only
    ? []
    : build_composio_proxy_node_seeds({ toolkit, app_name, maximum_length });
  const taken_names = new Set(proxy_seeds.map((seed) => seed.node_name));

  const action_seeds = input.tools.map((tool) =>
    build_composio_action_node_seed({
      toolkit,
      tool,
      app_name,
      node_name: claim_node_name(tool.slug, toolkit.slug, maximum_length, taken_names),
    }),
  );
  const trigger_seeds = input.triggers.map((trigger) =>
    build_composio_trigger_node_seed({
      toolkit,
      trigger,
      app_name,
      node_name: claim_node_name(trigger.slug, toolkit.slug, maximum_length, taken_names),
    }),
  );

  return [...proxy_seeds, ...action_seeds, ...trigger_seeds];
}

// Two tool slugs can normalize onto one node_name (`LIST_ROWS` and `LIST-ROWS`). The second one
// takes a name derived from its own slug so both survive the import.
function claim_node_name(
  provider_component_id: string,
  toolkit_slug: string,
  maximum_length: number,
  taken_names: Set<string>,
) {
  const base_name = composio_node_name(provider_component_id, toolkit_slug, maximum_length);
  if (!taken_names.has(base_name)) {
    taken_names.add(base_name);
    return base_name;
  }
  const node_name = append_hash_suffix(base_name, provider_component_id, maximum_length);
  taken_names.add(node_name);
  return node_name;
}

try {
  await main();
} finally {
  await close_database();
}

if (counters.failed_toolkits > 0) process.exit(1);
