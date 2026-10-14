import type { Database } from '@coworker/core/db/connection';
import { policy_decision_event_type } from '@coworker/core/db/queries/event_waits';
import { events } from '@coworker/core/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export type ApprovalAnswer = {
  decision: 'approved' | 'denied';
  reason: string | null;
  decided_by: string;
  decision_event_id: string;
};

export const approval_wake_channel = 'approval_answered';

export async function find_approval_answer(
  db: Database,
  input: { workspace_id: string; job_id: string; queue_key: string },
): Promise<ApprovalAnswer | null> {
  const decision = await db.query.events.findFirst({
    where: and(
      eq(events.workspace_id, input.workspace_id),
      eq(events.event_type, policy_decision_event_type),
      eq(events.queue_key, input.queue_key),
    ),
    orderBy: [desc(events.created_time)],
  });
  const body = decision?.event_body as
    | { job_id?: string; decision?: string; reason?: string }
    | undefined;
  if (!decision || body?.job_id !== input.job_id) return null;
  if (body.decision !== 'approved' && body.decision !== 'denied') return null;

  return {
    decision: body.decision,
    reason: body.reason ?? null,
    decided_by: decision.actor_key,
    decision_event_id: decision.event_id,
  };
}
