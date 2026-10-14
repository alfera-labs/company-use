import { lifecycle_columns } from '@coworker/core/db/schema/common';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The password a person signs in with on an install that runs its own sign-in. Only hashes are
 * stored: the password as an argon2id string, the recovery code as its SHA-256.
 */
export const user_passwords = pgTable('user_passwords', {
  user_id: text('user_id').primaryKey(),
  password_hash: text('password_hash').notNull(),
  recovery_code_hash: text('recovery_code_hash').notNull(),
  password_set_time: timestamp('password_set_time', { withTimezone: true }).notNull(),
  ...lifecycle_columns,
});
