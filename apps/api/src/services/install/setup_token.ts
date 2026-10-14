import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { count_attempt } from '@api/lib/attempt_limit';
import { read_setup_token_hash_file_path } from '@coworker/config/local_mode_switch';
import type { Database, DatabaseExecutor } from '@coworker/core';
import { has_any_user_password } from '@coworker/core/db/queries/user_passwords';
import { AppError } from '@coworker/shared';
import { sql } from 'drizzle-orm';

const sha256_hex_pattern = /^[0-9a-f]{64}$/u;
const setup_attempts_per_client_a_minute = 30;

async function read_first_word_of_setup_token_hash_file(): Promise<Buffer | null> {
  const path = read_setup_token_hash_file_path();
  if (!path) return null;
  const text = await readFile(path, 'utf8').catch(() => '');
  const first_word = text.trim().split(/\s+/u)[0]?.toLowerCase() ?? '';
  return sha256_hex_pattern.test(first_word) ? Buffer.from(first_word, 'hex') : null;
}

function setup_link_not_valid(): AppError {
  return new AppError('setup_link_not_valid', 'This setup link is not valid.', 404);
}

export function setup_is_finished(): AppError {
  return new AppError('setup_finished', 'This Alfera is set up. Sign in instead.', 410);
}

/**
 * Lets a setup call through, or throws. The installer writes the lowercase hex SHA-256 of the
 * token to the file SETUP_TOKEN_HASH_FILE names; a missing, empty or malformed file keeps the
 * setup page locked. The token works until the owner account exists; after that every setup call
 * is told setup is finished, whatever token it holds.
 */
export async function require_setup_token(
  db: DatabaseExecutor,
  input: { setup_token: string; client_address: string },
) {
  count_attempt(`setup:${input.client_address}`, setup_attempts_per_client_a_minute);
  if (await has_any_user_password(db)) throw setup_is_finished();
  const expected = await read_first_word_of_setup_token_hash_file();
  if (!expected) throw setup_link_not_valid();
  const given = createHash('sha256').update(input.setup_token).digest();
  if (!timingSafeEqual(given, expected)) throw setup_link_not_valid();
}

/**
 * Runs a setup write while no owner exists. Every setup write takes the same lock and looks
 * again, so a key check that was slow cannot write after the owner account was made, and two
 * owner accounts cannot be made at once.
 */
export function while_setup_is_open<T>(db: Database, work: (tx: Database) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('install_owner_setup'))`);
    if (await has_any_user_password(tx)) throw setup_is_finished();
    return work(tx as Database);
  });
}

export function setup_token_binding(setup_token: string): string {
  return `setup:${createHash('sha256').update(setup_token).digest('hex')}`;
}

export async function read_install_sign_in_state(db: DatabaseExecutor) {
  const [owner_password_is_set, hash] = await Promise.all([
    has_any_user_password(db),
    read_first_word_of_setup_token_hash_file(),
  ]);
  return { owner_password_is_set, setup_is_waiting: !owner_password_is_set && hash !== null };
}
