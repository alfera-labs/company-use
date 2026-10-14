import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ConnectionCredentialData } from '@coworker/core/db/schema/json_column_types';
import {
  find_key_that_sealed,
  seal_with_the_current_key,
} from '@coworker/core/integrations/credential_encryption_keys';
import {
  current_envelope_version,
  parse_sealed_credential_value,
  type SealedCredentialValue,
  salt_bytes,
} from '@coworker/core/integrations/sealed_credential_value';

type EncryptedCredentialEnvelope = {
  credential_source: string;
  envelope_version: 1;
  encrypted_values: Record<string, SealedCredentialValue>;
  metadata: Record<string, unknown>;
};

export function encrypt_connection_credentials(input: {
  credential_source: string;
  values: Record<string, string | null | undefined>;
  metadata?: Record<string, unknown>;
}): EncryptedCredentialEnvelope {
  return {
    credential_source: input.credential_source,
    envelope_version: 1,
    encrypted_values: Object.fromEntries(
      Object.entries(input.values)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([key, value]) => [key, encrypt_credential_value(value)]),
    ),
    metadata: input.metadata ?? {},
  };
}

export function add_connection_credential_values(input: {
  existing: ConnectionCredentialData | null;
  credential_source: string;
  values: Record<string, string | null | undefined>;
  metadata?: Record<string, unknown>;
  replacing_keys_prefixed_with?: string;
}): EncryptedCredentialEnvelope {
  const existing = input.existing ?? {};
  const encrypted_values = existing.encrypted_values ?? {};
  const kept = Object.entries(encrypted_values).filter(
    ([key]) =>
      !input.replacing_keys_prefixed_with || !key.startsWith(input.replacing_keys_prefixed_with),
  );
  const added = encrypt_connection_credentials(input);

  return {
    ...added,
    encrypted_values: {
      ...(Object.fromEntries(kept) as Record<string, SealedCredentialValue>),
      ...added.encrypted_values,
    },
    metadata: { ...(existing.metadata ?? {}), ...added.metadata },
  };
}

export function replace_connection_credential_values(input: {
  existing: ConnectionCredentialData | null;
  credential_source: string;
  values: Record<string, string | null | undefined>;
  keeping_keys: readonly string[];
  metadata?: Record<string, unknown>;
}): EncryptedCredentialEnvelope {
  const existing_values = input.existing?.encrypted_values ?? {};
  const kept = Object.entries(existing_values).filter(([key]) => input.keeping_keys.includes(key));
  const replaced = encrypt_connection_credentials(input);

  return {
    ...replaced,
    encrypted_values: {
      ...(Object.fromEntries(kept) as Record<string, SealedCredentialValue>),
      ...replaced.encrypted_values,
    },
  };
}

export function read_connection_credential_values(
  credentials: ConnectionCredentialData | null | undefined,
): Record<string, string> {
  if (!credentials) return {};
  const encrypted_values = credentials.encrypted_values ?? {};
  return Object.fromEntries(
    Object.keys(encrypted_values).flatMap((key) => {
      const value = read_connection_credential_value(credentials, key);
      return value === null ? [] : [[key, value] as const];
    }),
  );
}

export function read_connection_credential_value(
  credentials: ConnectionCredentialData | null | undefined,
  key: string,
) {
  if (!credentials) return null;
  const encrypted_values = credentials.encrypted_values ?? {};
  const encrypted_value = encrypted_values[key];
  if (encrypted_value !== undefined) return decrypt_credential_value(encrypted_value);

  const legacy_value = credentials[key];
  return typeof legacy_value === 'string' ? legacy_value : null;
}

function encrypt_credential_value(value: string): SealedCredentialValue {
  const salt = randomBytes(salt_bytes);
  const nonce = randomBytes(12);
  const key = seal_with_the_current_key(salt);
  const cipher = createCipheriv('aes-256-gcm', key.key_bytes, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  return {
    envelope_version: current_envelope_version,
    encryption: 'aes-256-gcm',
    key_id: key.key_id,
    salt: salt.toString('base64url'),
    nonce: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    auth_tag: cipher.getAuthTag().toString('base64url'),
  };
}

function decrypt_credential_value(value: unknown) {
  const parsed_value = parse_sealed_credential_value(value);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    find_key_that_sealed(parsed_value),
    Buffer.from(parsed_value.nonce, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(parsed_value.auth_tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed_value.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
