import type { Database } from '@coworker/core/db/connection';
import { notification_event_type } from '@coworker/core/db/queries/notification_outcomes';
import { events } from '@coworker/core/db/schema';
import type { NotificationHeld } from '@coworker/core/db/schema/automation_contracts';
import { and, eq, sql } from 'drizzle-orm';

export async function demote_notification_to_daily_summary(
  db: Database,
  input: {
    workspace_id: string;
    event_id: string;
    outcome_reason: string;
    held: NotificationHeld;
    actor_id: string;
  },
) {
  const patch = { outcome_reason: input.outcome_reason, held: input.held };
  await db
    .update(events)
    .set({
      event_type: notification_event_type('add_to_daily_summary'),
      event_body: sql`${events.event_body} || ${JSON.stringify(patch)}::jsonb`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(and(eq(events.workspace_id, input.workspace_id), eq(events.event_id, input.event_id)));
}
