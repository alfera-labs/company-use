import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { user_passwords, users } from '@coworker/core/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export type StoredUserPassword = {
  user_id: string;
  password_hash: string;
  recovery_code_hash: string;
};

export async function find_password_of_email(
  db: DatabaseExecutor,
  email: string,
): Promise<StoredUserPassword | null> {
  const [row] = await db
    .select({
      user_id: user_passwords.user_id,
      password_hash: user_passwords.password_hash,
      recovery_code_hash: user_passwords.recovery_code_hash,
    })
    .from(user_passwords)
    .innerJoin(
      users,
      and(eq(users.user_id, user_passwords.user_id), eq(users.user_status, 'active')),
    )
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function find_password_of_user(
  db: DatabaseExecutor,
  user_id: string,
): Promise<StoredUserPassword | null> {
  const [row] = await db
    .select({
      user_id: user_passwords.user_id,
      password_hash: user_passwords.password_hash,
      recovery_code_hash: user_passwords.recovery_code_hash,
    })
    .from(user_passwords)
    .where(eq(user_passwords.user_id, user_id))
    .limit(1);
  return row ?? null;
}

export async function has_any_user_password(db: DatabaseExecutor): Promise<boolean> {
  const [row] = await db.select({ found: sql<number>`1` }).from(user_passwords).limit(1);
  return Boolean(row);
}

export async function save_user_password(
  db: DatabaseExecutor,
  input: StoredUserPassword & { actor_id: string },
): Promise<void> {
  const now = new Date();
  const values = {
    password_hash: input.password_hash,
    recovery_code_hash: input.recovery_code_hash,
    password_set_time: now,
    last_updated_time: now,
    last_updated_by: input.actor_id,
  };
  await db
    .insert(user_passwords)
    .values({ user_id: input.user_id, ...values, created_by: input.actor_id })
    .onConflictDoUpdate({ target: user_passwords.user_id, set: values });
}

/**
 * Replaces the password and recovery code only while the stored recovery code is still the one
 * the caller checked, so one recovery code resets the password once. False when it changed.
 */
export async function replace_password_while_recovery_code_is(
  db: DatabaseExecutor,
  input: StoredUserPassword & { checked_recovery_code_hash: string; actor_id: string },
): Promise<boolean> {
  const now = new Date();
  const replaced = await db
    .update(user_passwords)
    .set({
      password_hash: input.password_hash,
      recovery_code_hash: input.recovery_code_hash,
      password_set_time: now,
      last_updated_time: now,
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(user_passwords.user_id, input.user_id),
        eq(user_passwords.recovery_code_hash, input.checked_recovery_code_hash),
      ),
    )
    .returning({ user_id: user_passwords.user_id });
  return replaced.length > 0;
}
