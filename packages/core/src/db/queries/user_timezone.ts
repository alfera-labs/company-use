import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { users } from '@coworker/core/db/schema';
import { NotFoundError } from '@coworker/shared';
import { eq, sql } from 'drizzle-orm';

const timezone_key = 'timezone';

/** The IANA time zone name stored for a person, or null when none is stored. */
export function read_timezone_from_user_data(user_data: Record<string, unknown>): string | null {
  const timezone = user_data[timezone_key];
  return typeof timezone === 'string' && timezone ? timezone : null;
}

export async function read_user_timezone(
  db: DatabaseExecutor,
  user_id: string,
): Promise<string | null> {
  const [row] = await db
    .select({ user_data: users.user_data })
    .from(users)
    .where(eq(users.user_id, user_id))
    .limit(1);
  return row ? read_timezone_from_user_data(row.user_data) : null;
}

export async function set_user_timezone(
  db: DatabaseExecutor,
  input: { user_id: string; timezone: string; actor_id: string },
): Promise<void> {
  const rows = await db
    .update(users)
    .set({
      user_data: sql`${users.user_data} || jsonb_build_object(${timezone_key}::text, ${input.timezone}::text)`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(users.user_id, input.user_id))
    .returning({ user_id: users.user_id });

  if (!rows[0]) throw new NotFoundError('User');
}
