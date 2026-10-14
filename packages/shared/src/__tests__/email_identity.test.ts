import { normalize_email_identity } from '@shared/email_identity';
import { describe, expect, it } from 'vitest';

describe('normalize_email_identity', () => {
  it('reads every dotted Gmail spelling as one inbox', () => {
    const spellings = [
      'samplemailbox@gmail.com',
      'sample.mail.box@gmail.com',
      's.ample.m.a.il.box@gmail.com',
      'samp.lemai.lb.ox@gmail.com',
      'SAMPLE.MAIL.BOX@Gmail.com',
      'samplemailbox+7@gmail.com',
      'sample.mail.box+anything@googlemail.com',
    ];
    const identities = new Set(spellings.map(normalize_email_identity));
    expect(identities).toEqual(new Set(['samplemailbox@gmail.com']));
  });

  it('keeps dots outside Gmail, where they separate two people', () => {
    expect(normalize_email_identity('john.smith@acme.com')).toBe('john.smith@acme.com');
    expect(normalize_email_identity('johnsmith@acme.com')).toBe('johnsmith@acme.com');
  });

  it('drops a plus tag everywhere, since every provider routes it to one inbox', () => {
    expect(normalize_email_identity('billing+alfera@acme.com')).toBe('billing@acme.com');
  });

  it('answers null for an address it cannot split', () => {
    expect(normalize_email_identity('not-an-address')).toBeNull();
    expect(normalize_email_identity('@gmail.com')).toBeNull();
    expect(normalize_email_identity('+tag@gmail.com')).toBeNull();
  });
});
