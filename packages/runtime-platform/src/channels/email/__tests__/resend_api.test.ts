import { build_inbound_email_message } from '@runtime-platform/channels/email/message_format';
import {
  fetch_received_email,
  send_email_reply,
} from '@runtime-platform/channels/email/resend_api';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('resend_api boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('raises a named error when RESEND_API_KEY is unset', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    await expect(fetch_received_email('em_1')).rejects.toMatchObject({
      code: 'resend_api_key_missing',
    });
  });

  it('raises resend_request_failed on a non-2xx provider response', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    );
    await expect(
      send_email_reply({
        from: 'acme@inbox.test.alfera.ai',
        to: ['ada@example.com'],
        subject: 'Re: Hi',
        text: 'Hello',
      }),
    ).rejects.toMatchObject({ code: 'resend_request_failed' });
  });

  it('strips CR/LF from outbound subjects (header-injection guard)', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetch_mock = vi.fn(
      async () => new Response(JSON.stringify({ id: 'sent_1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch_mock);

    await send_email_reply({
      from: 'acme@inbox.test.alfera.ai',
      to: ['ada@example.com'],
      subject: 'Re: Hi\r\nBcc: victim@example.com',
      text: 'Hello',
    });

    const [, init] = fetch_mock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).subject).toBe('Re: Hi Bcc: victim@example.com');
  });

  it('sends the idempotency key as a header, not in the body', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetch_mock = vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' })));
    vi.stubGlobal('fetch', fetch_mock);

    await send_email_reply({
      from: 'acme@inbox.test.alfera.ai',
      to: ['ada@example.com'],
      subject: 'Re: Hi',
      text: 'Hello',
      idempotency_key: 'email-respond/run_123',
    });

    const [, init] = fetch_mock.mock.calls[0] as unknown as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(init.headers['Idempotency-Key']).toBe('email-respond/run_123');
    expect(JSON.parse(init.body)).not.toHaveProperty('idempotency_key');
  });

  it('omits the header entirely when no key is given', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetch_mock = vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' })));
    vi.stubGlobal('fetch', fetch_mock);

    await send_email_reply({
      from: 'acme@inbox.test.alfera.ai',
      to: ['ada@example.com'],
      subject: 'Re: Hi',
      text: 'Hello',
    });

    const [, init] = fetch_mock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers).not.toHaveProperty('Idempotency-Key');
  });

  it('normalizes a fetched received email through the schema', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'em_1',
              from: 'Ada <ada@example.com>',
              to: ['acme@inbox.test.alfera.ai'],
              subject: 'Hello',
              text: 'Hi',
              message_id: '<abc@example.com>',
            }),
            { status: 200 },
          ),
      ),
    );

    const email = await fetch_received_email('em_1');
    expect(email).toMatchObject({ id: 'em_1', from: 'Ada <ada@example.com>', text: 'Hi' });
  });

  it('carries the provider\u2019s sender verdicts into the message, over the header', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'em_2',
              from: 'Ada <ada@example.com>',
              to: ['acme@inbox.test.alfera.ai'],
              subject: 'OK',
              text: 'OK',
              authentication: { spf: 'pass', dkim: 'fail', dmarc: 'fail' },
              headers: { 'authentication-results': 'x.test; spf=pass; dkim=pass; dmarc=pass' },
            }),
            { status: 200 },
          ),
      ),
    );

    const message = build_inbound_email_message(await fetch_received_email('em_2'));
    expect(message?.sender_authentication).toEqual({ dmarc: 'fail', spf: 'pass', dkim: 'fail' });
  });

  it('reads the verdict the receiving server wrote on top, not one the sender wrote under it', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'em_3',
              from: 'Ada <ada@example.com>',
              to: ['acme@inbox.test.alfera.ai'],
              subject: 'OK',
              text: 'OK',
              headers: [
                {
                  name: 'Authentication-Results',
                  value: 'mx.example.net; spf=fail; dkim=fail; dmarc=fail',
                },
                {
                  name: 'Authentication-Results',
                  value: 'mx.example.net; spf=pass; dkim=pass; dmarc=pass',
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    const message = build_inbound_email_message(await fetch_received_email('em_3'));
    expect(message?.sender_authentication).toEqual({ dmarc: 'fail', spf: 'fail', dkim: 'fail' });
  });
});
