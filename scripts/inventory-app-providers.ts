// What production does with one provider's apps, printed. Read-only: the Composio migration is
// decided from this table, so it must be runnable against any environment without risk.
//
//   bun run catalog:inventory local --provider composio
//   bun run catalog:inventory prod --json

import { close_database, get_database } from '@coworker/core/db/connection';
import {
  list_provider_app_usage,
  read_catalog_provider_totals,
} from '@coworker/core/db/queries/provider_app_usage';
import {
  provider_app_is_in_use,
  type ProviderAppUsage,
} from '@coworker/core/integrations/composio_catalog_plan';

const args = process.argv.slice(2);
const provider_key = read_flag('--provider') ?? 'composio';
const as_json = args.includes('--json');

const table_columns = [
  { header: 'app_name', read: (usage: ProviderAppUsage) => usage.app_name },
  { header: 'provider_app_slug', read: (usage: ProviderAppUsage) => usage.provider_app_slug ?? '' },
  { header: 'connections', read: (usage: ProviderAppUsage) => String(usage.connections) },
  { header: 'active', read: (usage: ProviderAppUsage) => String(usage.active_connections) },
  { header: 'tool_calls', read: (usage: ProviderAppUsage) => String(usage.tool_calls) },
  {
    header: 'last_tool_call_time',
    read: (usage: ProviderAppUsage) => usage.last_tool_call_time ?? '',
  },
  {
    header: 'enabled_node_refs',
    read: (usage: ProviderAppUsage) => String(usage.enabled_node_refs),
  },
  {
    header: 'in_use',
    read: (usage: ProviderAppUsage) => (provider_app_is_in_use(usage) ? 'yes' : 'no'),
  },
] as const;

async function main() {
  const db = get_database();
  const usage = await list_provider_app_usage(db, { provider_key });
  const totals = await read_catalog_provider_totals(db);

  if (as_json) {
    console.log(JSON.stringify({ provider_key, apps: usage, totals }, null, 2));
    return;
  }

  console.log(`app provider inventory: provider_key=${provider_key} apps=${usage.length}`);
  console.log(format_table(usage));
  console.log(
    `in use: ${usage.filter(provider_app_is_in_use).length} of ${usage.length} ${provider_key} apps`,
  );
  console.log('\napps by metadata.source');
  for (const row of totals.apps_by_source) console.log(`  ${row.source ?? 'unset'}: ${row.apps}`);
  console.log('\nnodes by provider_key');
  for (const row of totals.nodes_by_provider) console.log(`  ${row.provider_key}: ${row.nodes}`);
  console.log('\nconnections by provider_key and status');
  for (const row of totals.connections_by_provider) {
    console.log(`  ${row.provider_key} ${row.connection_status}: ${row.connections}`);
  }
}

function format_table(usage: ProviderAppUsage[]) {
  const rows = [
    table_columns.map((column) => column.header),
    ...usage.map((row) => table_columns.map((column) => column.read(row))),
  ];
  const widths = table_columns.map((_, index) =>
    Math.max(...rows.map((row) => (row[index] ?? '').length)),
  );
  return rows
    .map((row) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  '))
    .join('\n');
}

function read_flag(name: string) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

try {
  await main();
} finally {
  await close_database();
}
