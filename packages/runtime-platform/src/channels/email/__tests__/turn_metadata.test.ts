import type { InboundEmailMessage } from '@runtime-platform/channels/email/message_format';
import { build_email_turn_metadata } from '@runtime-platform/channels/email/turn_metadata';
import { describe, expect, it } from 'vitest';

function message(overrides: Partial<InboundEmailMessage> = {}): InboundEmailMessage {
  return {
    email_id: 'em_1',
    from: 'Ada <ada@client.com>',
    from_email: 'ada@client.com',
    to: ['acme@inbox.test.alfera.ai'],
    cc: [],
    subject: 'Invoice for March',
    body_text: 'hello',
    attachment_names: [],
    sender_authentication: { dmarc: 'pass' as const, spf: 'pass' as const, dkim: 'pass' as const },
    references: [],
    ...overrides,
  };
}

function facts(participants: string[], has_member_participant = true) {
  return {
    message: message(),
    workspace_address: 'acme@inbox.test.alfera.ai',
    thread: {
      session_id: 'ses_1',
      session_source: 'email' as const,
      participants,
      has_member_participant,
    },
  };
}

describe('build_email_turn_metadata reply recipients', () => {
  it('copies the other participants on a member thread', () => {
    const turn = build_email_turn_metadata(
      facts(['ada@client.com', 'bo@client.com', 'robin@example.com']),
    );

    expect(turn.reply_to_email).toBe('ada@client.com');
    expect(turn.reply_cc).toEqual(['bo@client.com', 'robin@example.com']);
  });

  it('caps the Cc list so a long thread cannot exceed the provider recipient limit', () => {
    const many = Array.from({ length: 120 }, (_, index) => `p${index}@client.com`);

    const turn = build_email_turn_metadata(facts(['ada@client.com', ...many]));

    expect(turn.reply_cc).toHaveLength(49);
    expect(turn.reply_cc.length + 1).toBeLessThanOrEqual(50);
    expect(turn.reply_cc.at(-1)).toBe('p119@client.com');
    expect(turn.reply_cc).not.toContain('ada@client.com');
  });

  it('answers only the sender when no workspace member is on the thread', () => {
    const turn = build_email_turn_metadata(
      facts(['ada@client.com', 'stranger@example.com'], false),
    );

    expect(turn.reply_cc).toEqual([]);
  });
});
