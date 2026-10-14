// Proof that the workspace finishing a ChatGPT sign-in is the one that started it.
//
// The device flow hands the browser a `device_auth_id` and a `user_code`, and whoever presents
// them back is given the approved token. The code is meant to be read out loud, so on its own it
// keeps nobody out — without this, a workspace holding another's pair could finish that sign-in
// and receive their subscription token.
//
// Signed rather than stored: the pair is short-lived and already round-trips through the browser,
// so a claim it carries needs no table and no cleanup.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { derive_key_for_purpose } from '@coworker/core/integrations/credential_encryption_keys';
import { AppError } from '@coworker/shared';

const claim_purpose = 'chatgpt-device-authorization';

export type ChatgptDeviceClaim = {
  device_auth_id: string;
  user_code: string;
  workspace_id: string;
};

export function sign_chatgpt_device_claim(input: ChatgptDeviceClaim): string {
  return createHmac('sha256', derive_key_for_purpose(claim_purpose))
    .update([input.device_auth_id, input.user_code, input.workspace_id].map(tagged).join(''))
    .digest('base64url');
}

export function assert_chatgpt_device_claim(input: ChatgptDeviceClaim & { claim: string }): void {
  const expected = Buffer.from(sign_chatgpt_device_claim(input), 'utf8');
  const presented = Buffer.from(input.claim, 'utf8');

  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    throw new AppError(
      'chatgpt_device_claim_invalid',
      'This ChatGPT sign-in was started by a different workspace.',
      403,
    );
  }
}

function tagged(value: string) {
  return `${value.length}:${value}`;
}
