import { createHash, randomBytes } from 'node:crypto';

/**
 * A sign-in link token or a session token: 32 random bytes the browser holds. Only the SHA-256
 * is stored, and a row is found by that hash, so no stored value signs anyone in and no
 * comparison of secrets can leak through timing.
 */
export function create_team_secret(): { secret: string; secret_hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, secret_hash: hash_team_secret(secret) };
}

export function hash_team_secret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url');
}
