import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { users } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

const notice_key = 'team_sign_in_notice';
const sign_ins_key = 'team_sign_ins';
const sign_ins_kept = 10;

const team_sign_in_schema = z.object({
  used_time: z.string(),
  made_by_name: z.string(),
  link_kind: z.enum(['invitation', 'command_line', 'new_link']),
});

/** One use of a sign-in link for a person: when, who made the link, and which kind it was. */
export type TeamSignIn = z.infer<typeof team_sign_in_schema>;

/**
 * Told once to a person at a sign-in: the sign-in before it. A link that somebody else used
 * ended the person's sessions, so the session that link made is the wrong place to tell it.
 */
export type TeamSignInNotice = TeamSignIn;

async function read_user_data(db: DatabaseExecutor, user_id: string) {
  const [user] = await db
    .select({ user_data: users.user_data })
    .from(users)
    .where(eq(users.user_id, user_id))
    .limit(1);
  return user?.user_data ?? {};
}

async function merge_user_data(db: DatabaseExecutor, user_id: string, values: object) {
  await db
    .update(users)
    .set({
      user_data: sql`${users.user_data} || ${JSON.stringify(values)}::jsonb`,
      ...updated_by(user_id),
    })
    .where(eq(users.user_id, user_id));
}

/** The last sign-ins of a person, newest first. */
export async function list_team_sign_ins(
  db: DatabaseExecutor,
  user_id: string,
): Promise<TeamSignIn[]> {
  const stored = z
    .array(team_sign_in_schema)
    .safeParse((await read_user_data(db, user_id))[sign_ins_key]);
  return stored.success ? stored.data : [];
}

/**
 * Adds one sign-in to the list of a person, and answers the one before it, or null at a first
 * sign-in. That earlier one becomes the notice of the person, so the session this sign-in
 * makes is told about it. A sign-in is never the notice of the session it made itself: the
 * person it was taken from would not see it there, and the taker could clear it.
 */
export async function record_team_sign_in(
  db: DatabaseExecutor,
  input: { user_id: string; sign_in: TeamSignIn },
): Promise<TeamSignIn | null> {
  const earlier = await list_team_sign_ins(db, input.user_id);
  const before = earlier[0] ?? null;
  await merge_user_data(db, input.user_id, {
    [sign_ins_key]: [input.sign_in, ...earlier].slice(0, sign_ins_kept),
    ...(before ? { [notice_key]: before } : {}),
  });
  return before;
}

/**
 * The notice waiting for a person, or null. Reading leaves it there: a page that reads it may
 * be a redirect the person never sees, so the page that shows it says so afterwards.
 */
export async function read_team_sign_in_notice(
  db: DatabaseExecutor,
  user_id: string,
): Promise<TeamSignInNotice | null> {
  const stored = team_sign_in_schema.safeParse((await read_user_data(db, user_id))[notice_key]);
  return stored.success ? stored.data : null;
}

/** The person has been shown the notice, so it goes away. */
export async function clear_team_sign_in_notice(
  db: DatabaseExecutor,
  user_id: string,
): Promise<void> {
  await db
    .update(users)
    .set({ user_data: sql`${users.user_data} - ${notice_key}`, ...updated_by(user_id) })
    .where(eq(users.user_id, user_id));
}
