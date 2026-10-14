import { count_attempt } from '@api/lib/attempt_limit';
import { verify_password } from '@api/services/team/password_hash';
import { create_recovery_code } from '@api/services/team/recovery_code';
import type { Database } from '@coworker/core';
import {
  find_password_of_user,
  replace_password_while_recovery_code_is,
} from '@coworker/core/db/queries/user_passwords';
import { AppError } from '@coworker/shared';

const password_checks_per_person_a_minute = 10;

export async function person_has_a_password(db: Database, user_id: string): Promise<boolean> {
  return (await find_password_of_user(db, user_id)) !== null;
}

/**
 * A signed-in person with a password makes a new recovery code after typing the password again.
 * The new code is shown once, and the old one stops working at the same moment.
 */
export async function make_new_recovery_code(
  db: Database,
  input: { user_id: string; password: string },
): Promise<{ recovery_code: string }> {
  count_attempt(`recovery_code:${input.user_id}`, password_checks_per_person_a_minute);
  const stored = await find_password_of_user(db, input.user_id);
  if (!stored || !(await verify_password(input.password, stored.password_hash))) {
    throw new AppError('password_refused', 'That password is not right.', 403);
  }
  const recovery = create_recovery_code();
  const replaced = await replace_password_while_recovery_code_is(db, {
    user_id: stored.user_id,
    password_hash: stored.password_hash,
    recovery_code_hash: recovery.recovery_code_hash,
    checked_recovery_code_hash: stored.recovery_code_hash,
    actor_id: input.user_id,
  });
  if (!replaced) {
    throw new AppError('recovery_code_changed', 'The recovery code just changed. Try again.', 409);
  }
  return { recovery_code: recovery.recovery_code };
}
