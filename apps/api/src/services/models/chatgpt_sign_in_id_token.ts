import { chatgpt_plan_auth_base_url } from '@coworker/runtime-platform';
import { AppError } from '@coworker/shared';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const openai_key_set = createRemoteJWKSet(
  new URL(`${chatgpt_plan_auth_base_url}/.well-known/jwks.json`),
);

export async function verify_chatgpt_id_token(
  id_token: string | undefined,
  expected: { client_id: string; nonce: string },
): Promise<{ email: string | null; subject: string }> {
  if (!id_token) throw id_token_error('ChatGPT sent no ID token.');

  const { payload } = await jwtVerify(id_token, openai_key_set, {
    issuer: chatgpt_plan_auth_base_url,
    audience: expected.client_id,
  }).catch((error: unknown) => {
    throw id_token_error('ChatGPT sent an ID token that does not check out.', error);
  });
  if (payload.nonce !== expected.nonce || !payload.sub) {
    throw id_token_error('ChatGPT sent an ID token for a different sign-in.');
  }
  return {
    email: typeof payload.email === 'string' ? payload.email : null,
    subject: payload.sub,
  };
}

function id_token_error(message: string, cause?: unknown) {
  return new AppError('chatgpt_sign_in_failed', message, 502, {
    ...(cause === undefined ? {} : { cause: String(cause) }),
  });
}
