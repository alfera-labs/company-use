import type { Database } from '@coworker/core/db/connection';
import { automations } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import { and, eq, sql } from 'drizzle-orm';

export async function count_one_more_run_without_progress(
  db: Database,
  input: { workspace_id: string; automation_id: string; actor_id: string },
): Promise<number> {
  const [row] = await db
    .update(automations)
    .set({
      metadata: sql`jsonb_set(${automations.metadata}, '{no_progress_streak}',
        to_jsonb(coalesce((${automations.metadata} ->> 'no_progress_streak')::int, 0) + 1))`,
      ...updated_by(input.actor_id),
    })
    .where(
      and(
        eq(automations.workspace_id, input.workspace_id),
        eq(automations.automation_id, input.automation_id),
      ),
    )
    .returning({ metadata: automations.metadata });
  return read_no_progress_streak(row?.metadata);
}

export async function clear_automation_no_progress_streak(
  db: Database,
  input: { workspace_id: string; automation_id: string; actor_id: string },
): Promise<void> {
  await db
    .update(automations)
    .set({
      metadata: sql`${automations.metadata} - 'no_progress_streak'`,
      ...updated_by(input.actor_id),
    })
    .where(
      and(
        eq(automations.workspace_id, input.workspace_id),
        eq(automations.automation_id, input.automation_id),
      ),
    );
}

export async function start_automation_budget_over(
  db: Database,
  input: { workspace_id: string; automation_id: string; now: Date; actor_id: string },
): Promise<void> {
  const reset = JSON.stringify({ budget_reset_time: input.now.toISOString() });
  await db
    .update(automations)
    .set({
      metadata: sql`(${automations.metadata} - 'no_progress_streak') || ${reset}::jsonb`,
      ...updated_by(input.actor_id),
    })
    .where(
      and(
        eq(automations.workspace_id, input.workspace_id),
        eq(automations.automation_id, input.automation_id),
      ),
    );
}

function read_no_progress_streak(metadata: Record<string, unknown> | null | undefined) {
  const streak = metadata?.no_progress_streak;
  return typeof streak === 'number' ? streak : 0;
}
