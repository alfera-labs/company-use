import type { Database } from '@coworker/core/db/connection';
import { run_wrote_a_notification } from '@coworker/core/db/queries/notification_outcomes';
import { tool_calls } from '@coworker/core/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

const writing_risk_classes = ['write', 'send', 'exec'];

export async function run_made_progress(
  db: Database,
  input: { workspace_id: string; run_id: string },
): Promise<boolean> {
  const [changed_something] = await db
    .select({ tool_call_id: tool_calls.tool_call_id })
    .from(tool_calls)
    .where(
      and(
        eq(tool_calls.workspace_id, input.workspace_id),
        eq(tool_calls.run_id, input.run_id),
        eq(tool_calls.tool_status, 'completed'),
        inArray(tool_calls.risk_class, writing_risk_classes),
      ),
    )
    .limit(1);
  if (changed_something) return true;

  return run_wrote_a_notification(db, input);
}
