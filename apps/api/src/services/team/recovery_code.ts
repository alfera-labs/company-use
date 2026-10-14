import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const code_alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const code_length = 24;
const group_length = 4;

export function create_recovery_code(): { recovery_code: string; recovery_code_hash: string } {
  const letters = [...randomBytes(code_length)].map((byte) => code_alphabet[byte % 32]).join('');
  const groups = letters.match(new RegExp(`.{${group_length}}`, 'gu')) ?? [];
  const recovery_code = groups.join('-');
  return { recovery_code, recovery_code_hash: hash_recovery_code(recovery_code) };
}

export function hash_recovery_code(recovery_code: string): string {
  const normalized = recovery_code.toUpperCase().replace(/[\s-]/gu, '');
  return createHash('sha256').update(normalized).digest('hex');
}

export function recovery_code_matches(recovery_code: string, stored_hash: string): boolean {
  const given = Buffer.from(hash_recovery_code(recovery_code), 'hex');
  const stored = Buffer.from(stored_hash, 'hex');
  return given.length === stored.length && timingSafeEqual(given, stored);
}
