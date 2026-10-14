import {
  find_approved_chatgpt_authorization,
  refresh_chatgpt_tokens,
  start_chatgpt_device_authorization,
} from '@runtime-platform/openai_codex_oauth';
import { describe, expect, it } from 'vitest';

describe('the sign-in with a ChatGPT subscription in this edition', () => {
  it('refuses every call with not_in_this_edition', async () => {
    const refusal = { code: 'not_in_this_edition' };

    await expect(start_chatgpt_device_authorization()).rejects.toMatchObject(refusal);
    await expect(
      find_approved_chatgpt_authorization({ device_auth_id: 'device-1', user_code: 'ABCD-12345' }),
    ).rejects.toMatchObject(refusal);
    await expect(refresh_chatgpt_tokens('refresh-1')).rejects.toMatchObject(refusal);
  });
});
