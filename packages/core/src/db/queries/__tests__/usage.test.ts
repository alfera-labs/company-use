import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  summarize_brain_source_usage_this_month,
  summarize_workspace_usage,
} from '@coworker/core/db/queries/usage';
import { usage_records } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { beforeEach, describe, expect, it } from 'vitest';

const ws = 'ws_usage_test';

async function insert_usage(
  db: Database,
  input: {
    usage_kind: string;
    provider: string | null;
    usage_date: string;
    cost_microcents: number;
    quantity: string;
    usage_metadata?: Record<string, unknown>;
  },
) {
  await db.insert(usage_records).values({
    usage_record_id: create_id(id_prefixes.usage_record),
    workspace_id: ws,
    usage_date: input.usage_date,
    usage_kind: input.usage_kind,
    provider: input.provider,
    provider_name: input.provider,
    quantity: input.quantity,
    unit: 'token',
    cost_microcents: input.cost_microcents,
    usage_metadata: input.usage_metadata ?? {},
    created_by: ws,
    last_updated_by: ws,
  });
}

describe('summarize_workspace_usage', () => {
  let db: Database;
  beforeEach(async () => {
    db = await create_test_database();
  });

  it('aggregates total, by kind, by provider, and by day', async () => {
    await insert_usage(db, {
      usage_kind: 'llm_tokens',
      provider: 'anthropic',
      usage_date: '2026-06-01',
      cost_microcents: 3_000_000,
      quantity: '100',
    });
    await insert_usage(db, {
      usage_kind: 'llm_tokens',
      provider: 'anthropic',
      usage_date: '2026-06-02',
      cost_microcents: 2_000_000,
      quantity: '50',
    });
    await insert_usage(db, {
      usage_kind: 'tool_call',
      provider: 'composio',
      usage_date: '2026-06-02',
      cost_microcents: 1_000_000,
      quantity: '5',
    });

    const summary = await summarize_workspace_usage(db, { workspace_id: ws });

    expect(summary.total_cost_microcents).toBe(6_000_000);
    expect(summary.by_kind.find((k) => k.usage_kind === 'llm_tokens')?.cost_microcents).toBe(
      5_000_000,
    );
    expect(summary.by_kind.find((k) => k.usage_kind === 'llm_tokens')?.quantity).toBe(150);
    expect(summary.by_kind.find((k) => k.usage_kind === 'tool_call')?.cost_microcents).toBe(
      1_000_000,
    );
    expect(summary.daily.length).toBe(2);
    expect(summary.daily.map((d) => d.usage_date)).toEqual(['2026-06-01', '2026-06-02']);
  });

  it('includes brain_source_sync rows in the by-kind breakdown', async () => {
    await insert_usage(db, {
      usage_kind: 'brain_source_sync',
      provider: 'google_drive',
      usage_date: '2026-06-03',
      cost_microcents: 0,
      quantity: '4',
      usage_metadata: { brain_source_id: 'bsrc_a', composio_calls: 2 },
    });

    const summary = await summarize_workspace_usage(db, { workspace_id: ws });

    const brain_source_sync = summary.by_kind.find((k) => k.usage_kind === 'brain_source_sync');
    expect(brain_source_sync?.quantity).toBe(4);
  });
});

describe('summarize_brain_source_usage_this_month', () => {
  let db: Database;
  beforeEach(async () => {
    db = await create_test_database();
  });

  function this_month_date(day_of_month: number): string {
    const now = new Date();
    return new Date(now.getUTCFullYear(), now.getUTCMonth(), day_of_month)
      .toISOString()
      .slice(0, 10);
  }

  it('sums items_synced and composio_calls for one source, this month only', async () => {
    await insert_usage(db, {
      usage_kind: 'brain_source_sync',
      provider: 'google_drive',
      usage_date: this_month_date(1),
      cost_microcents: 0,
      quantity: '3',
      usage_metadata: { brain_source_id: 'bsrc_target', composio_calls: 2 },
    });
    await insert_usage(db, {
      usage_kind: 'brain_source_sync',
      provider: 'google_drive',
      usage_date: this_month_date(2),
      cost_microcents: 0,
      quantity: '5',
      usage_metadata: { brain_source_id: 'bsrc_target', composio_calls: 4 },
    });
    await insert_usage(db, {
      usage_kind: 'brain_source_sync',
      provider: 'google_drive',
      usage_date: this_month_date(2),
      cost_microcents: 0,
      quantity: '100',
      usage_metadata: { brain_source_id: 'bsrc_other', composio_calls: 50 },
    });
    await insert_usage(db, {
      usage_kind: 'brain_source_sync',
      provider: 'google_drive',
      usage_date: '2020-01-01',
      cost_microcents: 0,
      quantity: '999',
      usage_metadata: { brain_source_id: 'bsrc_target', composio_calls: 999 },
    });

    const usage = await summarize_brain_source_usage_this_month(db, {
      workspace_id: ws,
      brain_source_id: 'bsrc_target',
    });

    expect(usage).toEqual({ items_synced: 8, composio_calls: 6 });
  });

  it('reports zero for a source with no usage rows yet', async () => {
    const usage = await summarize_brain_source_usage_this_month(db, {
      workspace_id: ws,
      brain_source_id: 'bsrc_never_synced',
    });

    expect(usage).toEqual({ items_synced: 0, composio_calls: 0 });
  });
});
