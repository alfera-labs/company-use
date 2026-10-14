import type {
  AutomationRule,
  AutomationTrigger,
  AutomationTriggerInput,
  TriggerTypeApp,
  TriggerTypeCatalog,
  TriggerTypeRow,
} from '@/components/app/automations/automations_api';
import { describe_schedule } from '@/lib/scheduled_task_schedule';

export type PickerRow = {
  key: string;
  kind: 'schedule' | 'manual' | 'webhook' | 'app_event';
  display_name: string;
  description: string | null;
  app: TriggerTypeApp | null;
  row: TriggerTypeRow | null;
  cron?: string;
};

export const schedule_preset_rows: PickerRow[] = [
  { cron: '0 * * * *', display_name: 'Hourly', description: 'Every hour, on the hour' },
  { cron: '0 9 * * *', display_name: 'Daily', description: 'Every day at 9:00' },
  { cron: '0 9 * * 1', display_name: 'Weekly', description: 'Every Monday at 9:00' },
  { cron: undefined, display_name: 'Custom', description: 'Pick the days and the time' },
].map(({ cron, display_name, description }) => ({
  key: `schedule:${display_name.toLowerCase()}`,
  kind: 'schedule' as const,
  display_name,
  description,
  app: null,
  row: null,
  ...(cron ? { cron } : {}),
}));

export const manual_picker_row: PickerRow = {
  key: 'manual',
  kind: 'manual',
  display_name: 'When you ask',
  description: 'A Test button, or saying so in chat',
  app: null,
  row: null,
};

export const webhook_picker_row: PickerRow = {
  key: 'webhook',
  kind: 'webhook',
  display_name: 'When anything on the web calls it',
  description: 'A URL and a secret; any system that can POST JSON',
  app: null,
  row: null,
};

export type CatalogEntry = { app: TriggerTypeApp; row: TriggerTypeRow };

const only_once_connected = new Set(['composio_slackbot']);

function preference(app: TriggerTypeApp) {
  return (app.connected ? 2 : 0) + (app.app_name.startsWith('composio_') ? 0 : 1);
}

export function picker_apps(catalog: TriggerTypeCatalog | undefined): TriggerTypeApp[] {
  const offered = (catalog?.apps ?? []).filter(
    (app) => app.connected || !only_once_connected.has(app.app_name),
  );
  const best = new Map<string, TriggerTypeApp>();
  for (const app of offered) {
    const seen = best.get(app.app_display_name);
    if (!seen || preference(app) > preference(seen)) best.set(app.app_display_name, app);
  }
  return offered.filter((app) => best.get(app.app_display_name) === app);
}

function index_trigger_types(catalog: TriggerTypeCatalog | undefined): Map<string, CatalogEntry> {
  const by_key = new Map<string, CatalogEntry>();
  for (const app of catalog?.apps ?? []) {
    for (const row of app.trigger_types) by_key.set(row.node_key, { app, row });
  }
  return by_key;
}

export function find_trigger_type(
  catalog: TriggerTypeCatalog | undefined,
  node_key: string,
): CatalogEntry | null {
  return index_trigger_types(catalog).get(node_key) ?? null;
}

export function catalog_picker_row({ app, row }: CatalogEntry): PickerRow {
  return {
    key: row.node_key,
    kind: 'app_event',
    display_name: row.display_name,
    description: row.description,
    app,
    row,
  };
}

type TriggerSearchGroup = { app: TriggerTypeApp; rows: TriggerTypeRow[] };
export type TriggerSearchResult = { matched: number; total: number; groups: TriggerSearchGroup[] };

export function search_trigger_types(
  catalog: TriggerTypeCatalog | undefined,
  query: string,
): TriggerSearchResult {
  const apps = picker_apps(catalog);
  const total = apps.reduce((sum, app) => sum + app.trigger_types.length, 0);
  const needle = query.trim().toLowerCase();
  if (!needle) return { matched: 0, total, groups: [] };

  const groups: TriggerSearchGroup[] = [];
  let matched = 0;
  for (const app of apps) {
    const rows = app.trigger_types.filter((row) => row_matches(app, row, needle));
    if (rows.length === 0) continue;
    matched += rows.length;
    groups.push({ app, rows });
  }
  return { matched, total, groups };
}

function row_matches(app: TriggerTypeApp, row: TriggerTypeRow, needle: string): boolean {
  const haystack = `${row.display_name} ${row.description ?? ''} ${app.app_display_name}`;
  return haystack.toLowerCase().includes(needle);
}

type TriggerConfig = {
  timezone?: string | undefined;
  event_source?:
    | { node_key?: string; connection_id?: string; subscription_config?: Record<string, unknown> }
    | undefined;
  rules?: AutomationRule[] | undefined;
};

export function trigger_row_to_input(trigger: AutomationTrigger): AutomationTriggerInput {
  const config = (trigger.trigger_config ?? {}) as TriggerConfig;
  if (trigger.trigger_type === 'schedule') {
    return {
      kind: 'schedule',
      cron: trigger.schedule_expression ?? '',
      ...(config.timezone ? { timezone: config.timezone } : {}),
    };
  }
  if (trigger.trigger_type === 'manual') return { kind: 'manual' };
  if (trigger.trigger_type === 'webhook') return { kind: 'webhook' };
  const source = config.event_source ?? {};
  return {
    kind: 'app_event',
    node_key: source.node_key ?? '',
    ...(source.connection_id ? { connection_id: source.connection_id } : {}),
    subscription_config: source.subscription_config ?? {},
    conditions: config.rules ?? [],
  };
}

export function describe_trigger_input(
  input: AutomationTriggerInput,
  catalog: TriggerTypeCatalog | undefined,
): { line: string; sub: string | null } {
  if (input.kind === 'schedule') {
    return { line: describe_schedule(input.cron), sub: input.timezone ?? null };
  }
  if (input.kind === 'manual') return { line: manual_picker_row.display_name, sub: null };
  if (input.kind === 'webhook') return { line: webhook_picker_row.display_name, sub: null };
  const found = find_trigger_type(catalog, input.node_key);
  return {
    line: found?.row.display_name ?? input.node_key,
    sub: describe_subscription(input.subscription_config),
  };
}

function describe_subscription(config: Record<string, unknown> | undefined): string | null {
  const words = Object.values(config ?? {})
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .map(String)
    .filter((value) => value.trim());
  return words.length > 0 ? words.join(', ') : null;
}
