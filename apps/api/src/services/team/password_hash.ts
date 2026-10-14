import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import p_limit from 'p-limit';

const argon2id_settings = { memory: 19_456, passes: 2, parallelism: 1, tag_length: 32 } as const;
const salt_bytes = 16;
export const most_password_hashes_at_once = 2;
const run_with_few_hashes_at_once = p_limit(most_password_hashes_at_once);
const phc_pattern =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/u;

type Argon2idSettings = { memory: number; passes: number; parallelism: number };

function derive_argon2id_tag(
  password: string,
  salt: Buffer,
  settings: Argon2idSettings & { tag_length: number },
): Promise<Buffer> {
  return run_with_few_hashes_at_once(() => derive_argon2id_tag_now(password, salt, settings));
}

function derive_argon2id_tag_now(
  password: string,
  salt: Buffer,
  settings: Argon2idSettings & { tag_length: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: password,
        nonce: salt,
        memory: settings.memory,
        passes: settings.passes,
        parallelism: settings.parallelism,
        tagLength: settings.tag_length,
      },
      (error, tag) => (error ? reject(error) : resolve(tag)),
    );
  });
}

function unpadded_base64(value: Buffer): string {
  return value.toString('base64').replace(/=+$/u, '');
}

export async function hash_password(password: string): Promise<string> {
  const salt = randomBytes(salt_bytes);
  const tag = await derive_argon2id_tag(password, salt, argon2id_settings);
  const { memory, passes, parallelism } = argon2id_settings;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${unpadded_base64(salt)}$${unpadded_base64(tag)}`;
}

/** True when the password matches the stored hash. A hash in another format never matches. */
export async function verify_password(password: string, stored_hash: string): Promise<boolean> {
  const parts = phc_pattern.exec(stored_hash);
  if (!parts) return false;
  const [, memory, passes, parallelism, salt, expected_tag] = parts;
  const expected = Buffer.from(expected_tag ?? '', 'base64');
  const tag = await derive_argon2id_tag(password, Buffer.from(salt ?? '', 'base64'), {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tag_length: expected.length,
  });
  return timingSafeEqual(tag, expected);
}
