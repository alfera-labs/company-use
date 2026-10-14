import { createHash, randomBytes } from 'node:crypto';
import { derive_key_for_purpose } from '@coworker/core/integrations/credential_encryption_keys';
import {
  encrypt_connection_credentials,
  read_connection_credential_value,
} from '@coworker/core/integrations/credential_envelope';
import { AppError } from '@coworker/shared';
import { z } from 'zod';

const attempt_value_name = 'chatgpt_sign_in_attempt';
const attempt_lifetime_ms = 15 * 60 * 1000;

const attempt_schema = z
  .object({
    state: z.string().min(1),
    nonce: z.string().min(1),
    code_verifier: z.string().min(1),
    redirect_uri: z.string().min(1),
    client_id: z.string().min(1).optional(),
    bound_to: z.string().optional(),
    expires_at_ms: z.number(),
  })
  .strict();

export type ChatgptSignInAttempt = z.infer<typeof attempt_schema>;

export function create_chatgpt_sign_in_attempt(input: {
  redirect_uri: string;
  client_id?: string | undefined;
  bound_to?: string | undefined;
}): ChatgptSignInAttempt {
  return {
    state: random_text(),
    nonce: random_text(),
    code_verifier: random_text(),
    redirect_uri: input.redirect_uri,
    ...(input.client_id ? { client_id: input.client_id } : {}),
    ...(input.bound_to ? { bound_to: input.bound_to } : {}),
    expires_at_ms: Date.now() + attempt_lifetime_ms,
  };
}

export function code_challenge_of(attempt: ChatgptSignInAttempt): string {
  return createHash('sha256').update(attempt.code_verifier).digest('base64url');
}

/** The attempt travels through the browser sealed, so its PKCE verifier never shows there. */
export function seal_chatgpt_sign_in_attempt(attempt: ChatgptSignInAttempt): string {
  const envelope = encrypt_connection_credentials({
    credential_source: attempt_value_name,
    values: { [attempt_value_name]: JSON.stringify(attempt) },
  });
  return Buffer.from(JSON.stringify(envelope)).toString('base64url');
}

export function open_chatgpt_sign_in_attempt(
  sealed: string,
  bound_to: string | undefined,
): ChatgptSignInAttempt {
  const attempt = read_sealed_attempt(sealed);
  if (attempt.expires_at_ms < Date.now()) {
    throw new AppError('chatgpt_sign_in_expired', 'This sign-in expired. Start again.', 400);
  }
  if (attempt.bound_to !== bound_to) {
    throw new AppError('chatgpt_sign_in_failed', 'This sign-in was started somewhere else.', 403);
  }
  return attempt;
}

export function derive_chatgpt_agent_host_id(): string {
  const bytes = derive_key_for_purpose('chatgpt-agent-host-id').subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  const groups = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20)];
  return `urn:uuid:${[...groups, hex.slice(20, 32)].join('-')}`;
}

function read_sealed_attempt(sealed: string): ChatgptSignInAttempt {
  try {
    const envelope = JSON.parse(Buffer.from(sealed, 'base64url').toString('utf8'));
    const value = read_connection_credential_value(envelope, attempt_value_name);
    return attempt_schema.parse(JSON.parse(value ?? ''));
  } catch {
    throw new AppError(
      'chatgpt_sign_in_failed',
      'This sign-in could not be read. Start again.',
      400,
    );
  }
}

function random_text() {
  return randomBytes(32).toString('base64url');
}
