import { createHash, hkdfSync } from 'node:crypto';
import { AppError } from '@coworker/shared';

const key_derivation_info = 'coworker-credential-envelope-v2';
const purpose_salt = Buffer.from('coworker-purpose-key-v1', 'utf8');
const development_key_source = 'coworker-local-development-credential-key';
const shortest_production_key = 32;

type CredentialKey = {
  key_id: string;
  key_material: Buffer;
  legacy_key_id: string;
  legacy_key_bytes: Buffer;
};

function read_credential_key(key_source: string): CredentialKey {
  const legacy_digest = createHash('sha256').update(key_source).digest();
  return {
    key_id: createHash('sha256')
      .update(`credential-key-id:${key_source}`)
      .digest('hex')
      .slice(0, 12),
    key_material: Buffer.from(key_source, 'utf8'),
    legacy_key_id: legacy_digest.toString('hex').slice(0, 12),
    legacy_key_bytes: legacy_digest,
  };
}

function read_credential_keys(): { current: CredentialKey; fallbacks: CredentialKey[] } {
  const secret = process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  const in_production = process.env.NODE_ENV === 'production';
  if (!secret && in_production) {
    throw new AppError(
      'credential_encryption_not_configured',
      'COWORKER_CREDENTIAL_ENCRYPTION_KEY is required in production.',
      500,
    );
  }
  if (secret && in_production && secret.length < shortest_production_key) {
    throw new AppError(
      'credential_encryption_key_too_short',
      `COWORKER_CREDENTIAL_ENCRYPTION_KEY must be at least ${shortest_production_key} characters.`,
      500,
    );
  }

  return {
    current: read_credential_key(secret ?? development_key_source),
    fallbacks: (process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY_FALLBACKS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(read_credential_key),
  };
}

function derive_value_key(key: CredentialKey, salt: Buffer): Buffer {
  return Buffer.from(
    hkdfSync('sha256', key.key_material, salt, key_derivation_info, 32) as ArrayBuffer,
  );
}

export function derive_key_for_purpose(purpose: string): Buffer {
  return derive_purpose_key(read_credential_keys().current, purpose);
}

export function derive_keys_for_purpose(purpose: string): Buffer[] {
  const { current, fallbacks } = read_credential_keys();
  return [current, ...fallbacks].map((key) => derive_purpose_key(key, purpose));
}

function derive_purpose_key(key: CredentialKey, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', key.key_material, purpose_salt, `purpose:${purpose}`, 32) as ArrayBuffer,
  );
}

export function seal_with_the_current_key(salt: Buffer): { key_id: string; key_bytes: Buffer } {
  const key = read_credential_keys().current;
  return { key_id: key.key_id, key_bytes: derive_value_key(key, salt) };
}

export function find_key_that_sealed(value: {
  envelope_version: 1 | 2;
  key_id: string;
  salt?: string | undefined;
}): Buffer {
  const { current, fallbacks } = read_credential_keys();
  for (const key of [current, ...fallbacks]) {
    if (value.envelope_version === 1) {
      if (value.key_id === key.legacy_key_id) return key.legacy_key_bytes;
      continue;
    }
    if (value.key_id === key.key_id && value.salt) {
      return derive_value_key(key, Buffer.from(value.salt, 'base64url'));
    }
  }

  throw new AppError(
    'credential_key_mismatch',
    'No configured credential encryption key matches this credential.',
    500,
  );
}
