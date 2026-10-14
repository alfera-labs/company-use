import {
  build_reply_subject,
  normalize_email_subject,
} from '@runtime-platform/channels/email/turn_subject';
import { describe, expect, it } from 'vitest';

describe('normalize_email_subject', () => {
  it.each([
    ['Re: Weekly update', 'weekly update'],
    ['RE: re: Fwd: Weekly update', 'weekly update'],
    ['Fwd: Weekly   update ', 'weekly update'],
    ['Weekly update', 'weekly update'],
  ])('normalizes %s', (subject, expected) => {
    expect(normalize_email_subject(subject)).toBe(expected);
  });
});

describe('build_reply_subject', () => {
  it('prefixes Re: once', () => {
    expect(build_reply_subject('Weekly update')).toBe('Re: Weekly update');
    expect(build_reply_subject('Re: Weekly update')).toBe('Re: Weekly update');
  });
});

describe('build_reply_subject length ceiling', () => {
  it('keeps an ordinary subject untouched', () => {
    expect(build_reply_subject('Invoice for March')).toBe('Re: Invoice for March');
  });

  it('truncates a subject that would exceed the RFC 5322 header line limit', () => {
    const long_subject = 'x'.repeat(2_000);

    const reply_subject = build_reply_subject(long_subject);

    expect(reply_subject.length).toBeLessThanOrEqual(900);
    expect(reply_subject.endsWith('…')).toBe(true);
    expect(reply_subject.startsWith('Re: xxx')).toBe(true);
  });
});
