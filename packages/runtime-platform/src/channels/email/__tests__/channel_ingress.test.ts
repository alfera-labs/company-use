import { createHmac } from 'node:crypto';

import { verify_and_parse_resend_request } from '@runtime-platform/channels/email/channel_ingress';
import { afterEach, describe, expect, it, vi } from 'vitest';

const webhook_secret_bytes = Buffer.from('secret-secret-secret');
const webhook_secret = `whsec_${webhook_secret_bytes.toString('base64')}`;

function signed_request(body: unknown, overrides: Record<string, string> = {}) {
  const body_text = JSON.stringify(body);
  const message_id = overrides['svix-id'] ?? 'msg_1';
  const timestamp = overrides['svix-timestamp'] ?? String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', webhook_secret_bytes)
    .update(`${message_id}.${timestamp}.${body_text}`)
    .digest('base64');
  return new Request('https://api.example.com/v1/channels/email/events', {
    method: 'POST',
    body: body_text,
    headers: {
      'svix-id': message_id,
      'svix-timestamp': timestamp,
      'svix-signature': overrides['svix-signature'] ?? `v1,${signature}`,
      ...overrides,
    },
  });
}

const received_body = {
  type: 'email.received',
  created_at: '2026-08-01T00:00:00.000Z',
  data: {
    email_id: 'em_123',
    from: 'Ada <ada@example.com>',
    to: ['acme@inbox.test.alfera.ai'],
    subject: 'Hello',
    message_id: '<abc@example.com>',
  },
};

describe('verify_and_parse_resend_request', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a correctly signed email.received event', async () => {
    vi.stubEnv('RESEND_INBOUND_WEBHOOK_SECRET', webhook_secret);
    const result = await verify_and_parse_resend_request(signed_request(received_body));
    expect(result.kind).toBe('event');
    if (result.kind !== 'event') return;
    expect(result.event.channel_provider_key).toBe('email');
    expect(result.event.provider_event_id).toBe('em_123');
    expect(result.event.provider_event_type).toBe('email.received');
  });

  it('rejects a tampered body', async () => {
    vi.stubEnv('RESEND_INBOUND_WEBHOOK_SECRET', webhook_secret);
    const request = signed_request(received_body);
    const tampered = new Request(request.url, {
      method: 'POST',
      body: JSON.stringify({
        ...received_body,
        data: { ...received_body.data, email_id: 'em_evil' },
      }),
      headers: request.headers,
    });
    await expect(verify_and_parse_resend_request(tampered)).rejects.toMatchObject({
      code: 'resend_signature_invalid',
    });
  });

  it('rejects a stale timestamp', async () => {
    vi.stubEnv('RESEND_INBOUND_WEBHOOK_SECRET', webhook_secret);
    const stale = String(Math.floor(Date.now() / 1000) - 600);
    await expect(
      verify_and_parse_resend_request(signed_request(received_body, { 'svix-timestamp': stale })),
    ).rejects.toMatchObject({ code: 'resend_signature_expired' });
  });

  it('rejects missing signature headers when a secret is configured', async () => {
    vi.stubEnv('RESEND_INBOUND_WEBHOOK_SECRET', webhook_secret);
    const request = new Request('https://api.example.com/v1/channels/email/events', {
      method: 'POST',
      body: JSON.stringify(received_body),
    });
    await expect(verify_and_parse_resend_request(request)).rejects.toMatchObject({
      code: 'resend_signature_missing',
    });
  });

  it('skips verification when no secret is configured outside production', async () => {
    vi.stubEnv('RESEND_INBOUND_WEBHOOK_SECRET', '');
    const request = new Request('https://api.example.com/v1/channels/email/events', {
      method: 'POST',
      body: JSON.stringify(received_body),
    });
    const result = await verify_and_parse_resend_request(request);
    expect(result.kind).toBe('event');
  });
});
