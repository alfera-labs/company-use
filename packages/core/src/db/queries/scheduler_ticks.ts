import type { Database } from '@coworker/core/db/connection';
import { scheduler_ticks } from '@coworker/core/db/schema';
import { sql } from 'drizzle-orm';

export async function claim_scheduler_tick(
  db: Database,
  input: { tick_name: string; tick_time: Date; actor_id: string },
): Promise<boolean> {
  const rows = await db
    .insert(scheduler_ticks)
    .values({
      tick_name: input.tick_name,
      last_tick_time: input.tick_time,
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .onConflictDoUpdate({
      target: scheduler_ticks.tick_name,
      set: {
        last_tick_time: sql`excluded.last_tick_time`,
        last_updated_time: sql`now()`,
        last_updated_by: sql`excluded.last_updated_by`,
      },
      setWhere: sql`${scheduler_ticks.last_tick_time} < excluded.last_tick_time`,
    })
    .returning({ tick_name: scheduler_ticks.tick_name });
  return rows.length > 0;
}
