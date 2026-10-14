import { describe, expect, it, vi } from 'vitest';

const hashes = vi.hoisted(() => ({ running: 0, most_running: 0 }));

vi.mock('node:crypto', async (import_original) => {
  const crypto = await import_original<typeof import('node:crypto')>();
  const argon2: typeof crypto.argon2 = (algorithm, parameters, callback) => {
    hashes.running += 1;
    hashes.most_running = Math.max(hashes.most_running, hashes.running);
    crypto.argon2(algorithm, parameters, (error, tag) => {
      hashes.running -= 1;
      callback(error, tag);
    });
  };
  return { ...crypto, argon2 };
});

const { hash_password, most_password_hashes_at_once, verify_password } = await import(
  '@api/services/team/password_hash'
);

describe('password hashes', () => {
  it('run a few at a time however many sign-ins arrive at once', async () => {
    const stored = await hash_password('a long owner password');
    hashes.most_running = 0;
    const guesses = Array.from({ length: 8 }, (_unused, index) => `wrong guess ${index}`);
    const answers = await Promise.all(guesses.map((guess) => verify_password(guess, stored)));

    expect(answers.every((matches) => matches === false)).toBe(true);
    expect(hashes.most_running).toBe(most_password_hashes_at_once);
    expect(await verify_password('a long owner password', stored)).toBe(true);
  });
});
