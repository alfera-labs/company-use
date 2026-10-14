import type { Database } from '@coworker/core/db/connection';
import { usage_records } from '@coworker/core/db/schema';
import { and, eq, gte, lte, sql } from 'drizzle-orm';

export type UsageSummary = {
  total_cost_microcents: number;
  by_kind: { usage_kind: string; cost_microcents: number; quantity: number }[];
  by_provider: { provider: string | null; cost_microcents: number }[];
  daily: { usage_date: string; cost_microcents: number }[];
};

export async function summarize_workspace_usage(
  db: Database,
  input: { workspace_id: string; since?: string; until?: string },
): Promise<UsageSummary> {
  const scope = and(
    eq(usage_records.workspace_id, input.workspace_id),
    ...(input.since ? [gte(usage_records.usage_date, input.since)] : []),
    ...(input.until ? [lte(usage_records.usage_date, input.until)] : []),
  );

  const by_kind = await db
    .select({
      usage_kind: usage_records.usage_kind,
      cost_microcents: sql<string>`coalesce(sum(${usage_records.cost_microcents}), 0)`,
      quantity: sql<string>`coalesce(sum(${usage_records.quantity}::numeric), 0)`,
    })
    .from(usage_records)
    .where(scope)
    .groupBy(usage_records.usage_kind);

  const by_provider = await db
    .select({
      provider: usage_records.provider,
      cost_microcents: sql<string>`coalesce(sum(${usage_records.cost_microcents}), 0)`,
    })
    .from(usage_records)
    .where(scope)
    .groupBy(usage_records.provider);

  const daily = await db
    .select({
      usage_date: usage_records.usage_date,
      cost_microcents: sql<string>`coalesce(sum(${usage_records.cost_microcents}), 0)`,
    })
    .from(usage_records)
    .where(scope)
    .groupBy(usage_records.usage_date)
    .orderBy(usage_records.usage_date);

  const by_kind_rows = by_kind.map((row) => ({
    usage_kind: row.usage_kind,
    cost_microcents: Number(row.cost_microcents),
    quantity: Number(row.quantity),
  }));

  return {
    total_cost_microcents: by_kind_rows.reduce((sum, row) => sum + row.cost_microcents, 0),
    by_kind: by_kind_rows,
    by_provider: by_provider.map((row) => ({
      provider: row.provider,
      cost_microcents: Number(row.cost_microcents),
    })),
    daily: daily.map((row) => ({
      usage_date: String(row.usage_date),
      cost_microcents: Number(row.cost_microcents),
    })),
  };
}

export type BrainSourceUsageSummary = { items_synced: number; composio_calls: number };

export async function summarize_brain_source_usage_this_month(
  db: Database,
  input: { workspace_id: string; brain_source_id: string },
): Promise<BrainSourceUsageSummary> {
  const [row] = await db
    .select({
      items_synced: sql<string>`coalesce(sum(${usage_records.quantity}::numeric), 0)`,
      composio_calls: sql<string>`coalesce(sum((${usage_records.usage_metadata}->>'composio_calls')::numeric), 0)`,
    })
    .from(usage_records)
    .where(
      and(
        eq(usage_records.workspace_id, input.workspace_id),
        eq(usage_records.usage_kind, 'brain_source_sync'),
        sql`${usage_records.usage_metadata}->>'brain_source_id' = ${input.brain_source_id}`,
        gte(usage_records.usage_date, sql`date_trunc('month', now())::date`),
      ),
    );
  return {
    items_synced: Number(row?.items_synced ?? 0),
    composio_calls: Number(row?.composio_calls ?? 0),
  };
}
