import { ValidationError } from '@coworker/shared';

export const current_envelope_version = 2;
export const salt_bytes = 16;

const base64url_pattern = /^[A-Za-z0-9_-]*$/;
const credential_key_id_pattern = /^[0-9a-f]{12}$/;
const sealed_value_fields = new Set([
  'envelope_version',
  'encryption',
  'key_id',
  'salt',
  'nonce',
  'ciphertext',
  'auth_tag',
]);

export type SealedCredentialValue = {
  envelope_version: 1 | 2;
  encryption: 'aes-256-gcm';
  key_id: string;
  salt?: string;
  nonce: string;
  ciphertext: string;
  auth_tag: string;
};

export function parse_sealed_credential_value(value: unknown): SealedCredentialValue {
  const candidate = read_object_with_known_fields(value);
  const version = candidate.envelope_version;
  if (
    (version !== 1 && version !== 2) ||
    candidate.encryption !== 'aes-256-gcm' ||
    typeof candidate.key_id !== 'string' ||
    !credential_key_id_pattern.test(candidate.key_id) ||
    !is_canonical_base64url(candidate.nonce, 12) ||
    !is_canonical_base64url(candidate.ciphertext) ||
    !is_canonical_base64url(candidate.auth_tag, 16)
  ) {
    throw new ValidationError('Credential envelope is invalid');
  }
  const salt = candidate.salt;
  if (version === 2 ? !is_canonical_base64url(salt, salt_bytes) : salt !== undefined) {
    throw new ValidationError('Credential envelope is invalid');
  }

  return {
    envelope_version: version,
    encryption: candidate.encryption,
    key_id: candidate.key_id,
    ...(typeof salt === 'string' ? { salt } : {}),
    nonce: candidate.nonce,
    ciphertext: candidate.ciphertext,
    auth_tag: candidate.auth_tag,
  };
}

function read_object_with_known_fields(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((field) => !sealed_value_fields.has(field))
  ) {
    throw new ValidationError('Credential envelope is invalid');
  }
  return value as Record<string, unknown>;
}

function is_canonical_base64url(value: unknown, byte_length?: number): value is string {
  if (typeof value !== 'string' || !base64url_pattern.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return (
    decoded.toString('base64url') === value &&
    (byte_length === undefined || decoded.byteLength === byte_length)
  );
}
