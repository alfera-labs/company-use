import { createHmac } from 'node:crypto';
import {
  read_composio_webhook_event,
  verify_composio_webhook_signature,
} from '@runtime-platform/composio/composio_triggers';
import { describe, expect, it } from 'vitest';

const secret = 'whsec_composio_test_secret';
const webhook_id = 'msg_2f1c8e';
const raw_body = JSON.stringify({
  type: 'GMAIL_NEW_GMAIL_MESSAGE',
  metadata: { trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE' },
  data: { subject: 'Invoice' },
});
const now = new Date('2026-03-04T10:00:00.000Z');
const fresh_timestamp = String(Math.floor(now.getTime() / 1000));

function sign(input: { secret?: string; timestamp?: string; webhook_id?: string; body?: string }) {
  return createHmac('sha256', input.secret ?? secret)
    .update(
      `${input.webhook_id ?? webhook_id}.${input.timestamp ?? fresh_timestamp}.${input.body ?? raw_body}`,
    )
    .digest('base64');
}

describe('verify_composio_webhook_signature', () => {
  it('accepts the signature Composio sends, with and without the version prefix', () => {
    const signature = sign({});

    expect(
      verify_composio_webhook_signature({
        secret,
        raw_body,
        webhook_id,
        signature_header: `v1,${signature}`,
        timestamp_header: fresh_timestamp,
        now,
      }),
    ).toBe(true);

    expect(
      verify_composio_webhook_signature({
        secret,
        raw_body,
        webhook_id,
        signature_header: signature,
        timestamp_header: fresh_timestamp,
        now,
      }),
    ).toBe(true);
  });

  it('refuses a signature made with another secret', () => {
    expect(
      verify_composio_webhook_signature({
        secret,
        raw_body,
        webhook_id,
        signature_header: `v1,${sign({ secret: 'whsec_someone_else' })}`,
        timestamp_header: fresh_timestamp,
        now,
      }),
    ).toBe(false);
  });

  it('refuses a body that changed after it was signed', () => {
    expect(
      verify_composio_webhook_signature({
        secret,
        raw_body: `${raw_body} `,
        webhook_id,
        signature_header: `v1,${sign({})}`,
        timestamp_header: fresh_timestamp,
        now,
      }),
    ).toBe(false);
  });

  it('refuses a timestamp older than the 300 second tolerance', () => {
    const stale_timestamp = String(Math.floor(now.getTime() / 1000) - 301);

    expect(
      verify_composio_webhook_signature({
        secret,
        raw_body,
        webhook_id,
        signature_header: `v1,${sign({ timestamp: stale_timestamp })}`,
        timestamp_header: stale_timestamp,
        now,
      }),
    ).toBe(false);
  });

  it('accepts a timestamp inside the tolerance', () => {
    const recent_timestamp = String(Math.floor(now.getTime() / 1000) - 299);

    expect(
      verify_composio_webhook_signature({
        secret,
        raw_body,
        webhook_id,
        signature_header: `v1,${sign({ timestamp: recent_timestamp })}`,
        timestamp_header: recent_timestamp,
        now,
      }),
    ).toBe(true);
  });

  it('refuses a delivery with no webhook id and one with no timestamp', () => {
    expect(
      verify_composio_webhook_signature({
        secret,
        raw_body,
        webhook_id: '',
        signature_header: `v1,${sign({ webhook_id: '' })}`,
        timestamp_header: fresh_timestamp,
        now,
      }),
    ).toBe(false);

    expect(
      verify_composio_webhook_signature({
        secret,
        raw_body,
        webhook_id,
        signature_header: `v1,${sign({})}`,
        now,
      }),
    ).toBe(false);
  });
});

describe('read_composio_webhook_event', () => {
  it('reads a V3 envelope', () => {
    const event = read_composio_webhook_event({
      id: 'evt_1',
      type: 'GMAIL_NEW_GMAIL_MESSAGE',
      timestamp: '2026-03-04T10:00:00.000Z',
      metadata: {
        trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
        trigger_id: 'ti_1',
        connected_account_id: 'ca_1',
        user_id: 'ws_1',
      },
      data: { subject: 'Invoice' },
    });

    expect(event?.type).toBe('GMAIL_NEW_GMAIL_MESSAGE');
    expect(event?.metadata.trigger_slug).toBe('GMAIL_NEW_GMAIL_MESSAGE');
    expect(event?.metadata.connected_account_id).toBe('ca_1');
    expect(event?.data).toEqual({ subject: 'Invoice' });
  });

  it('answers null for a payload that is not one', () => {
    expect(read_composio_webhook_event({ type: 'GMAIL_NEW_GMAIL_MESSAGE' })).toBeNull();
    expect(read_composio_webhook_event({ metadata: { trigger_slug: 'X' } })).toBeNull();
    expect(read_composio_webhook_event('not an object')).toBeNull();
    expect(read_composio_webhook_event(null)).toBeNull();
  });
});
