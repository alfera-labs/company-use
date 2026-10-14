import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { is_the_match_email_in_team_mode } from '@coworker/core/db/queries/team_match_emails';
import { users } from '@coworker/core/db/schema';
import { format_person_name } from '@coworker/shared';
import { eq, or } from 'drizzle-orm';

export type UserRow = typeof users.$inferSelect;

export async function get_user(db: DatabaseExecutor, user_id: string) {
  const [row] = await db.select().from(users).where(eq(users.user_id, user_id)).limit(1);
  return row;
}

export async function find_user_by_email(db: Database, email: string) {
  const is_their_address = or(eq(users.email, email), is_the_match_email_in_team_mode(email));
  const [row] = await db.select().from(users).where(is_their_address).limit(1);
  return row;
}

export function user_display_name(user: Pick<UserRow, 'first_name' | 'last_name' | 'email'>) {
  const full_name = format_person_name(user.first_name, user.last_name).trim();
  return full_name || user.email;
}
