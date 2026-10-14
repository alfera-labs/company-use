import {
  build_inbound_email_message,
  email_message_text,
  is_auto_generated_email,
} from '@runtime-platform/channels/email/message_format';
import type { ReceivedEmail } from '@runtime-platform/channels/email/resend_api';
import { describe, expect, it } from 'vitest';

function received_email(overrides: Partial<ReceivedEmail> = {}): ReceivedEmail {
  return {
    id: 'em_1',
    from: 'Ada Lovelace <ada@example.com>',
    to: ['acme@inbox.test.alfera.ai'],
    subject: 'Weekly update',
    text: 'Here is the update.',
    message_id: '<msg-2@example.com>',
    headers: null,
    ...overrides,
  };
}

describe('build_inbound_email_message', () => {
  it('normalizes the sender and carries reply threading fields', () => {
    const message = build_inbound_email_message(
      received_email({
        headers: { references: '<msg-1@example.com>', 'in-reply-to': '<msg-1@example.com>' },
      }),
    );
    expect(message).toMatchObject({
      email_id: 'em_1',
      from_email: 'ada@example.com',
      subject: 'Weekly update',
      body_text: 'Here is the update.',
      message_id: '<msg-2@example.com>',
      in_reply_to: '<msg-1@example.com>',
      references: ['<msg-1@example.com>', '<msg-2@example.com>'],
    });
  });

  it('falls back to stripped html when no text part exists', () => {
    const message = build_inbound_email_message(
      received_email({ text: null, html: '<p>Hello <strong>there</strong></p><p>Bye</p>' }),
    );
    expect(message?.body_text).toBe('Hello there\nBye');
  });

  it('truncates giant bodies', () => {
    const message = build_inbound_email_message(received_email({ text: 'x'.repeat(30_000) }));
    expect(message?.body_text.length).toBeLessThan(21_000);
    expect(message?.body_text.endsWith('[... email truncated ...]')).toBe(true);
  });

  it('returns null when the sender has no parsable address', () => {
    expect(build_inbound_email_message(received_email({ from: 'garbled' }))).toBeNull();
  });

  it('drops malformed References and In-Reply-To values instead of echoing them', () => {
    const message = build_inbound_email_message(
      received_email({
        headers: {
          references: '<good@example.com> not-a-msg-id <also-good@example.com>',
          'in-reply-to': 'Bcc: victim@example.com',
        },
      }),
    );
    expect(message?.references).toEqual([
      '<good@example.com>',
      '<also-good@example.com>',
      '<msg-2@example.com>',
    ]);
    expect(message?.in_reply_to).toBeUndefined();
  });

  it('caps a giant References chain to the most recent ids', () => {
    const chain = Array.from({ length: 100 }, (_, index) => `<id-${index}@example.com>`).join(' ');
    const message = build_inbound_email_message(received_email({ headers: { references: chain } }));
    expect(message?.references).toHaveLength(30);
    expect(message?.references?.at(-1)).toBe('<msg-2@example.com>');
  });
});

describe('is_auto_generated_email', () => {
  it.each([
    [{ 'auto-submitted': 'auto-replied' }, true],
    [{ 'auto-submitted': 'no' }, false],
    [{ precedence: 'bulk' }, true],
    [{ 'list-id': '<news.example.com>' }, true],
    [{}, false],
  ])('classifies headers %j as %s', (headers, expected) => {
    expect(is_auto_generated_email(received_email({ headers }))).toBe(expected);
  });
});

describe('email_message_text', () => {
  it('frames headers, membership note, and body for the model', () => {
    const message = build_inbound_email_message(received_email());
    if (!message) throw new Error('message expected');

    const framed = email_message_text(message, { sender_is_workspace_member: false });
    expect(framed).toContain('From: Ada Lovelace <ada@example.com>');
    expect(framed).toContain('Subject: Weekly update');
    expect(framed).toContain('NOT a member of this workspace');
    expect(framed).toContain('Here is the update.');
  });

  it('omits the membership note when membership is unknown', () => {
    const message = build_inbound_email_message(received_email());
    if (!message) throw new Error('message expected');
    expect(email_message_text(message)).not.toContain('member of this workspace');
  });
});

describe('threading headers across provider shapes', () => {
  const root = '<root-1@mail.example.com>';
  const ours = '<ours-1@ses.example.com>';
  const self = '<self-1@mail.example.com>';

  it('reads References delivered as a JSON-encoded string (the live Resend shape)', () => {
    const message = build_inbound_email_message({
      id: 'em_live',
      from: 'Ada <ada@client.com>',
      to: ['acme@inbox.test'],
      subject: 'Re: hf',
      message_id: self,
      headers: { references: JSON.stringify([root, ours]), 'in-reply-to': ours },
    } as never);

    expect(message?.references).toEqual([root, ours, self]);
    expect(message?.in_reply_to).toBe(ours);
  });

  it('reads References delivered as an array', () => {
    const message = build_inbound_email_message({
      id: 'em_1',
      from: 'Ada <ada@client.com>',
      to: ['acme@inbox.test'],
      subject: 'Re: hf',
      message_id: self,
      headers: { references: [root, ours], 'in-reply-to': ours },
    } as never);

    expect(message?.references).toEqual([root, ours, self]);
    expect(message?.in_reply_to).toBe(ours);
  });

  it('still reads the RFC 5322 space-separated string form', () => {
    const message = build_inbound_email_message({
      id: 'em_2',
      from: 'Ada <ada@client.com>',
      to: ['acme@inbox.test'],
      subject: 'Re: hf',
      message_id: self,
      headers: { references: `${root} ${ours}`, 'in-reply-to': ours },
    } as never);

    expect(message?.references).toEqual([root, ours, self]);
    expect(message?.in_reply_to).toBe(ours);
  });

  it('ignores malformed entries in either shape', () => {
    const message = build_inbound_email_message({
      id: 'em_3',
      from: 'Ada <ada@client.com>',
      to: ['acme@inbox.test'],
      subject: 'Re: hf',
      message_id: self,
      headers: { references: ['not-a-message-id', root], 'in-reply-to': 'garbage' },
    } as never);

    expect(message?.references).toEqual([root, self]);
    expect(message?.in_reply_to).toBeUndefined();
  });
});
