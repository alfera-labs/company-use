import { createHmac } from 'node:crypto';
import {
  derive_key_for_purpose,
  derive_keys_for_purpose,
} from '@coworker/core/integrations/credential_encryption_keys';
import { secure_strings_equal } from '@coworker/shared/secure_strings_equal';

export function sign_claims(purpose: string, claims: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${body}.${sign_body(derive_key_for_purpose(purpose), body)}`;
}

export function read_signed_claims(purpose: string, token: string): unknown {
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) return null;
  const keys = derive_keys_for_purpose(purpose);
  if (!keys.some((key) => secure_strings_equal(sign_body(key, body), signature))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function sign_body(key: Buffer, body: string) {
  return createHmac('sha256', key).update(body).digest('base64url');
}
