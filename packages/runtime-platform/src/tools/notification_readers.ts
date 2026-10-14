import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { Database } from '@coworker/core';
import { visible_to_reader } from '@coworker/core/db/queries/session_visibility';
import { sessions } from '@coworker/core/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * A notification written with `only_the_principal_reads` was made from one person's own chats.
 * That person alone reads it, in every mode. It also stays out of the shared ideas.md, and no
 * automation hears it (see `follow_through_on_notification`).
 * In team mode, the notifications a person reads: the ones written in a chat that person
 * reads, and the ones written in no chat. Outside team mode every other notification, as before.
 * Kept after the page is read, so a page can come back short and its total still
 * counts every notification. Move the rule into the query when team mode shows an inbox page.
 */
export async function keep_notifications_person_reads<
  Notification extends {
    notification: {
      session_id: string | null;
      principal_id?: string | null;
      metadata?: Record<string, unknown>;
    };
  },
>(
  db: Database,
  person: { workspace_id: string; user_id: string },
  every_notification: Notification[],
): Promise<Notification[]> {
  const notifications = every_notification.filter(
    (one) =>
      one.notification.metadata?.only_the_principal_reads !== true ||
      one.notification.principal_id === person.user_id,
  );
  if (!is_team_mode_switched_on()) return notifications;
  const session_ids = notifications.flatMap((one) => one.notification.session_id ?? []);
  if (session_ids.length === 0) return notifications;
  const readable = await db
    .select({ session_id: sessions.session_id })
    .from(sessions)
    .where(
      and(
        eq(sessions.workspace_id, person.workspace_id),
        inArray(sessions.session_id, session_ids),
        visible_to_reader(person.workspace_id, person.user_id),
      ),
    );
  const readable_ids = new Set(readable.map((session) => session.session_id));
  return notifications.filter(
    (one) => one.notification.session_id === null || readable_ids.has(one.notification.session_id),
  );
}
