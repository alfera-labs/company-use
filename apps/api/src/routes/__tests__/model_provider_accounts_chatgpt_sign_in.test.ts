import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { describe, expect, it } from 'vitest';

describe('the sign-in with a ChatGPT subscription in this edition', () => {
  it('answers not_in_this_edition when a sign-in is started', async () => {
    const app = create_app(await create_test_database());

    const response = await app.request(
      '/v1/workspace/model-provider-accounts/chatgpt/start-connect',
      { method: 'POST' },
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatchObject({ code: 'not_in_this_edition' });
  });
});
