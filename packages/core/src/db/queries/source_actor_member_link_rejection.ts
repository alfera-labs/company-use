import type { Database } from '@coworker/core/db/connection';
import { source_actors } from '@coworker/core/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

const member_link_states_an_admin_can_reject = ['pending_confirmation', 'linked'];

/** Moves a pending or linked row back to `unlinked` and forgets the matched member. */
export async function reject_source_actor_member_link(
  db: Database,
  input: { workspace_id: string; source_actor_id: string; actor_id: string },
) {
  const [row] = await db
    .update(source_actors)
    .set({
      member_link_state: 'unlinked',
      linked_user_id: null,
      last_updated_by: input.actor_id,
      last_updated_time: new Date(),
    })
    .where(
      and(
        eq(source_actors.workspace_id, input.workspace_id),
        eq(source_actors.source_actor_id, input.source_actor_id),
        inArray(source_actors.member_link_state, member_link_states_an_admin_can_reject),
      ),
    )
    .returning();
  return row;
}
