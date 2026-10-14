import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import type { ConnectionCredentialData } from '@coworker/core/db/schema/json_column_types';
import {
  encrypt_connection_credentials,
  read_connection_credential_value,
} from '@coworker/core/integrations/credential_envelope';
import { AppError, ValidationError } from '@coworker/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const key_a = 'rotation-test-key-a-0123456789abcdef';
const key_b = 'rotation-test-key-b-0123456789abcdef';

afterEach(() => {
  vi.unstubAllEnvs();
});

function store(values: Record<string, string>): ConnectionCredentialData {
  return encrypt_connection_credentials({
    credential_source: 'test',
    values,
  }) as ConnectionCredentialData;
}

function create_stored_credentials(
  overrides: Record<string, unknown> = {},
): ConnectionCredentialData {
  const envelope = store({ token: 'secret-token' });

  return {
    ...envelope,
    encrypted_values: {
      token: { ...envelope.encrypted_values?.token, ...overrides },
    },
  } as ConnectionCredentialData;
}

function create_version_1_credentials(key_source: string): ConnectionCredentialData {
  const key_bytes = createHash('sha256').update(key_source).digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key_bytes, nonce);
  const ciphertext = Buffer.concat([cipher.update('secret-token', 'utf8'), cipher.final()]);

  return {
    credential_source: 'test',
    envelope_version: 1,
    metadata: {},
    encrypted_values: {
      token: {
        envelope_version: 1,
        encryption: 'aes-256-gcm',
        key_id: key_bytes.toString('hex').slice(0, 12),
        nonce: nonce.toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
        auth_tag: cipher.getAuthTag().toString('base64url'),
      },
    },
  } as ConnectionCredentialData;
}

describe('credential envelope storage boundary', () => {
  it('decrypts a valid persisted credential value', () => {
    expect(read_connection_credential_value(create_stored_credentials(), 'token')).toBe(
      'secret-token',
    );
  });

  it.each([
    ['unsupported envelope version', { envelope_version: 3 }],
    ['unsupported algorithm', { encryption: 'aes-128-gcm' }],
    ['malformed key id', { key_id: 'not-a-key-id' }],
    ['non-base64url nonce', { nonce: 'invalid+=' }],
    ['wrong nonce length', { nonce: Buffer.alloc(11).toString('base64url') }],
    ['non-canonical ciphertext', { ciphertext: 'YQ==' }],
    ['non-base64url auth tag', { auth_tag: 'invalid+=' }],
    ['wrong auth tag length', { auth_tag: Buffer.alloc(15).toString('base64url') }],
    ['unknown envelope field', { unexpected_field: true }],
    ['a derived value with no salt to derive from', { salt: undefined }],
    ['wrong salt length', { salt: Buffer.alloc(15).toString('base64url') }],
    ['non-base64url salt', { salt: 'invalid+=' }],
  ])('rejects %s before decryption', (_label, overrides) => {
    expect(() =>
      read_connection_credential_value(create_stored_credentials(overrides), 'token'),
    ).toThrow(ValidationError);
  });
});

describe('the key each stored value is encrypted under', () => {
  it('names its key without publishing any of it', () => {
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', key_a);
    const value = store({ token: 'secret-token' }).encrypted_values?.token;
    if (!value) throw new Error('nothing was encrypted');

    const key_digest = createHash('sha256').update(key_a).digest('hex');
    expect(value.key_id).not.toBe(key_digest.slice(0, 12));
    expect(key_digest).not.toContain(value.key_id);
  });

  it('derives a separate key for every value, under one configured key', () => {
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', key_a);
    const stored = store({ first: 'secret-token', second: 'secret-token' });

    expect(stored.encrypted_values?.first?.salt).not.toBe(stored.encrypted_values?.second?.salt);
    expect(stored.encrypted_values?.first?.ciphertext).not.toBe(
      stored.encrypted_values?.second?.ciphertext,
    );
  });
});

describe('rotating the credential encryption key', () => {
  it('still reads everything the retired key wrote', () => {
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', key_a);
    const written_under_the_old_key = store({ token: 'secret-token' });

    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', key_b);
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY_FALLBACKS', key_a);

    expect(read_connection_credential_value(written_under_the_old_key, 'token')).toBe(
      'secret-token',
    );
  });

  it('writes everything new under the current key, never a retired one', () => {
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', key_a);
    const before = store({ token: 'secret-token' }).encrypted_values?.token;

    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', key_b);
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY_FALLBACKS', key_a);
    const after = store({ token: 'secret-token' }).encrypted_values?.token;

    expect(after?.key_id).not.toBe(before?.key_id);
    expect(read_connection_credential_value(create_stored_credentials(), 'token')).toBe(
      'secret-token',
    );
  });

  it('reads rows written before per-value derivation, under the same key', () => {
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', key_a);

    expect(read_connection_credential_value(create_version_1_credentials(key_a), 'token')).toBe(
      'secret-token',
    );
  });

  it('reads rows written before per-value derivation, under a retired key', () => {
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', key_b);
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY_FALLBACKS', key_a);

    expect(read_connection_credential_value(create_version_1_credentials(key_a), 'token')).toBe(
      'secret-token',
    );
  });

  it('refuses a credential no configured key wrote', () => {
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', key_a);
    const orphaned = store({ token: 'secret-token' });

    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', key_b);
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY_FALLBACKS', '');

    expect(() => read_connection_credential_value(orphaned, 'token')).toThrow(AppError);
  });

  it('takes more than one retired key, so rotating twice loses nothing', () => {
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', key_a);
    const oldest = store({ token: 'secret-token' });

    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', 'rotation-test-key-c-0123456789abcdef');
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY_FALLBACKS', ` ${key_b} , ${key_a} `);

    expect(read_connection_credential_value(oldest, 'token')).toBe('secret-token');
  });
});

describe('the configured key itself', () => {
  it('refuses a production key short enough to guess offline', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', 'too-short');

    expect(() => store({ token: 'secret-token' })).toThrow(AppError);
  });

  it('accepts a production key of a real length', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', key_a);

    expect(read_connection_credential_value(store({ token: 'secret-token' }), 'token')).toBe(
      'secret-token',
    );
  });
});
