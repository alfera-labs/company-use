import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  check_recipe_conformance,
  type ComposioRecipe,
  type ConformanceNode,
  open_schema_detail,
  format_conformance_problems,
  format_conformance_summary,
  list_composio_recipes,
  list_recipe_node_references,
  type RecipeConformance,
} from '@coworker/connectors';
import { count_active_connected_accounts } from '@scripts/composio-recipes/composio_read_api';
import { describe_deprecations, load_conformance_nodes } from '@scripts/composio-recipes/load_conformance_nodes';
import { type ConnectionCountRow, read_recipe_catalog } from '@scripts/composio-recipes/read_recipe_catalog';

type AccountInventoryRow = {
  toolkit_slug: string;
  db_active_connections: number;
  db_other_connections: number;
  composio_active_accounts: number | null;
};

function read_report_path(argv: readonly string[]): string {
  const index = argv.indexOf('--report');
  return index >= 0 && argv[index + 1] ? String(argv[index + 1]) : '.cache/recipe-conformance.json';
}

function list_recipe_node_keys(recipe: ComposioRecipe): string[] {
  return [...new Set(list_recipe_node_references(recipe).map((reference) => reference.node_key))];
}

function build_inventory_row(
  recipe: ComposioRecipe,
  app_ids: ReadonlySet<string>,
  connection_counts: readonly ConnectionCountRow[],
  composio_counts: ReadonlyMap<string, number> | null,
): AccountInventoryRow {
  const rows = connection_counts.filter((row) => app_ids.has(row.app_id));
  const sum = (filter: (row: ConnectionCountRow) => boolean) =>
    rows.filter(filter).reduce((total, row) => total + Number(row.connection_count), 0);
  return {
    toolkit_slug: recipe.toolkit_slug,
    db_active_connections: sum((row) => row.connection_status === 'active'),
    db_other_connections: sum((row) => row.connection_status !== 'active'),
    composio_active_accounts: composio_counts ? (composio_counts.get(recipe.toolkit_slug) ?? 0) : null,
  };
}

function format_inventory(rows: readonly AccountInventoryRow[]): string {
  const lines = rows.map(
    (row) =>
      `| ${row.toolkit_slug} | ${row.db_active_connections} | ${row.db_other_connections} | ${row.composio_active_accounts ?? 'n/a'} |`,
  );
  return ['| recipe | dev DB active | dev DB other | Composio ACTIVE |', '| --- | --- | --- | --- |', ...lines].join('\n');
}

async function read_composio_counts(): Promise<Map<string, number> | null> {
  try {
    return await count_active_connected_accounts();
  } catch (error) {
    console.error(`Composio connected-accounts list failed: ${String(error)}`);
    return null;
  }
}

function print_report(results: readonly RecipeConformance[], inventory: readonly AccountInventoryRow[], deprecations: unknown[]) {
  console.log('## Verdict per recipe\n');
  console.log(format_conformance_summary(results));
  console.log('\n## Problems\n');
  console.log(format_conformance_problems(results));
  console.log('\n## Deprecated nodes\n');
  console.log(JSON.stringify(deprecations, null, 2));
  console.log('\n## Live accounts\n');
  console.log(format_inventory(inventory));
}

function check_all_recipes(recipes: readonly ComposioRecipe[], nodes: ReadonlyMap<string, ConformanceNode>) {
  return recipes.map((recipe) => check_recipe_conformance(recipe, (node_key) => nodes.get(node_key)));
}

function list_open_node_keys(results: readonly RecipeConformance[]): Set<string> {
  const open = results.flatMap((result) => result.problems.filter((problem) => problem.actual === open_schema_detail));
  return new Set(open.map((problem) => problem.node_key));
}

async function main() {
  const recipes = list_composio_recipes();
  const node_keys = [...new Set(recipes.flatMap(list_recipe_node_keys))];
  const catalog = await read_recipe_catalog(node_keys);
  const rows = [...catalog.nodes_by_key.values()];
  const [catalog_nodes, deprecations, composio_counts] = await Promise.all([
    load_conformance_nodes(rows),
    describe_deprecations(rows),
    read_composio_counts(),
  ]);
  const open_node_keys = list_open_node_keys(check_all_recipes(recipes, catalog_nodes));
  const nodes = await load_conformance_nodes(rows, open_node_keys);
  const results = check_all_recipes(recipes, nodes);
  const inventory = recipes.map((recipe) => {
    const app_ids = new Set(list_recipe_node_keys(recipe).flatMap((key) => catalog.nodes_by_key.get(key)?.app_id ?? []));
    return build_inventory_row(recipe, app_ids, catalog.connection_counts, composio_counts);
  });
  const output_sources = Object.fromEntries([...nodes.values()].map((node) => [node.node_key, node.output_source]));
  const report_path = read_report_path(process.argv);
  mkdirSync(dirname(report_path), { recursive: true });
  writeFileSync(report_path, `${JSON.stringify({ results, deprecations, inventory, output_sources }, null, 2)}\n`);
  print_report(results, inventory, deprecations);
  console.log(`\nreport: ${report_path}`);
  if (results.some((result) => result.verdict === 'FAIL')) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
