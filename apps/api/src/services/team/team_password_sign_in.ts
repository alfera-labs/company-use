import { count_attempt } from '@api/lib/attempt_limit';
import { hash_password, verify_password } from '@api/services/team/password_hash';
import { create_recovery_code, recovery_code_matches } from '@api/services/team/recovery_code';
import { start_team_session, type TeamSession } from '@api/services/team/team_session_start';
import type { Database } from '@coworker/core';
import { delete_team_sessions_of_member } from '@coworker/core/db/queries/team_sessions';
import { find_team_actor } from '@coworker/core/db/queries/team_workspace';
import {
  find_password_of_email,
  replace_password_while_recovery_code_is,
  type StoredUserPassword,
} from '@coworker/core/db/queries/user_passwords';

const attempts_per_client_a_minute = 30;
const attempts_per_email_from_one_address_a_minute = 10;
const attempts_per_email_from_every_address_a_minute = 100;
const stored_password_checked_for_an_unknown_email: StoredUserPassword = {
  user_id: '',
  password_hash:
    '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  recovery_code_hash: '0'.repeat(64),
};

export type SignInAttempt = { email: string; client_address: string };
export type RecoveredSignIn = TeamSession & { recovery_code: string };

function count_sign_in_attempt(attempt: SignInAttempt): void {
  const email = attempt.email.trim().toLowerCase();
  count_attempt(`sign_in:${attempt.client_address}`, attempts_per_client_a_minute);
  count_attempt(
    `sign_in_email:${attempt.client_address}:${email}`,
    attempts_per_email_from_one_address_a_minute,
  );
  count_attempt(`sign_in_email:${email}`, attempts_per_email_from_every_address_a_minute);
}

async function find_member_who_proves_identity(
  db: Database,
  attempt: SignInAttempt,
  proves_identity: (stored: StoredUserPassword) => Promise<boolean> | boolean,
) {
  count_sign_in_attempt(attempt);
  const stored = await find_password_of_email(db, attempt.email);
  if (!stored) {
    await proves_identity(stored_password_checked_for_an_unknown_email);
    return null;
  }
  if (!(await proves_identity(stored))) return null;
  const actor = await find_team_actor(db, { user_id: stored.user_id });
  if (!actor) return null;
  return { workspace_id: actor.workspace_id, user_id: actor.user_id, stored };
}

export async function sign_in_with_password(
  db: Database,
  input: SignInAttempt & { password: string },
): Promise<TeamSession | null> {
  const member = await find_member_who_proves_identity(db, input, (stored) =>
    verify_password(input.password, stored.password_hash),
  );
  return member ? start_team_session(db, member) : null;
}

/**
 * The recovery code sets a new password. Every session the person had ends, the code is used up,
 * and a new code is made and shown once. Null when the email and code do not match, or when the
 * same code was used a moment ago.
 */
export async function reset_password_with_recovery_code(
  db: Database,
  input: SignInAttempt & { recovery_code: string; new_password: string },
): Promise<RecoveredSignIn | null> {
  const member = await find_member_who_proves_identity(db, input, (stored) =>
    recovery_code_matches(input.recovery_code, stored.recovery_code_hash),
  );
  if (!member) return null;
  const [password_hash, recovery] = [
    await hash_password(input.new_password),
    create_recovery_code(),
  ];
  const session = await db.transaction(async (tx) => {
    const replaced = await replace_password_while_recovery_code_is(tx, {
      user_id: member.user_id,
      password_hash,
      recovery_code_hash: recovery.recovery_code_hash,
      checked_recovery_code_hash: member.stored.recovery_code_hash,
      actor_id: member.user_id,
    });
    if (!replaced) return null;
    await delete_team_sessions_of_member(tx, member);
    return start_team_session(tx, member);
  });
  return session ? { ...session, recovery_code: recovery.recovery_code } : null;
}
