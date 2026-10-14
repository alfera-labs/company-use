import { createHmac } from 'node:crypto';
import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { afterEach, describe, expect, it, vi } from 'vitest';

const signing_secret = 'slack-press-on-events-path-secret';

describe('a button press arriving on the events URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    '/v1/events/channels/slack-platform',
    '/v1/channels/slack/events',
  ])('is handled as a press on %s, not rejected as a malformed event', async (path) => {
    vi.stubEnv('SLACK_SIGNING_SECRET', signing_secret);
    const app = create_app(await create_test_database());

    const response = await app.request(path, signed_form_request({ type: 'view_submission' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('still turns away an unsigned form body', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', signing_secret);
    const app = create_app(await create_test_database());

    const response = await app.request('/v1/events/channels/slack-platform', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
        'x-slack-signature': 'v0=not-the-signature',
      },
      body: form_body({ type: 'view_submission' }),
    });

    expect(response.status).toBe(401);
  });
});

function signed_form_request(payload: unknown) {
  const body = form_body(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = `v0=${createHmac('sha256', signing_secret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')}`;
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    },
    body,
  };
}

function form_body(payload: unknown) {
  return new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
}
