import {
  read_email_sender_authentication,
  sender_domain_is_authenticated,
  sender_is_trusted_member,
} from '@runtime-platform/channels/email/sender_authentication';
import { describe, expect, it } from 'vitest';

const live_header =
  'amazonses.com; spf=pass (spfCheck: domain of example.com designates 192.0.2.48 as permitted sender) client-ip=192.0.2.48; envelope-from=robin@example.com; helo=mail.example.net; dkim=pass header.i=@example.com; dmarc=pass header.from=example.com;';

describe('read_email_sender_authentication', () => {
  it('reads all three verdicts from a real Authentication-Results header', () => {
    expect(read_email_sender_authentication(live_header)).toEqual({
      dmarc: 'pass',
      spf: 'pass',
      dkim: 'pass',
    });
  });

  it('reads a failing DMARC verdict', () => {
    const header = 'amazonses.com; spf=fail; dkim=none; dmarc=fail header.from=example.com;';
    expect(read_email_sender_authentication(header)).toEqual({
      dmarc: 'fail',
      spf: 'fail',
      dkim: 'none',
    });
  });

  it('does not read a verdict out of the parenthetical commentary', () => {
    const header =
      'amazonses.com; spf=pass (this domain would pass if it were allowed); dmarc=fail header.from=evil.example;';
    expect(read_email_sender_authentication(header).dmarc).toBe('fail');
  });

  it('treats an absent or unparseable header as no proof, never as a pass', () => {
    expect(read_email_sender_authentication(undefined).dmarc).toBe('none');
    expect(read_email_sender_authentication(null).dmarc).toBe('none');
    expect(read_email_sender_authentication(['array']).dmarc).toBe('none');
    expect(read_email_sender_authentication('nonsense').dmarc).toBe('none');
  });

  it('treats softfail and permerror as failures', () => {
    expect(read_email_sender_authentication('dmarc=softfail;').dmarc).toBe('fail');
    expect(read_email_sender_authentication('dmarc=permerror;').dmarc).toBe('fail');
  });
});

describe('read_email_sender_authentication with the provider\u2019s own verdicts', () => {
  it('takes the verdicts the provider reports', () => {
    expect(
      read_email_sender_authentication(undefined, { spf: 'pass', dkim: 'pass', dmarc: 'pass' }),
    ).toEqual({ dmarc: 'pass', spf: 'pass', dkim: 'pass' });
  });

  it('believes the provider over a header that claims a pass', () => {
    const forged_header = 'amazonses.com; spf=pass; dkim=pass; dmarc=pass header.from=example.com;';
    expect(
      read_email_sender_authentication(forged_header, { spf: 'fail', dkim: 'none', dmarc: 'fail' }),
    ).toEqual({ dmarc: 'fail', spf: 'fail', dkim: 'none' });
  });

  it('treats a verdict the provider left out as no proof, even when the header has one', () => {
    expect(read_email_sender_authentication(live_header, { spf: 'pass' }).dmarc).toBe('none');
    expect(read_email_sender_authentication(live_header, { dmarc: null }).dmarc).toBe('none');
  });

  it('reads the header when the provider reports no verdicts at all', () => {
    expect(read_email_sender_authentication(live_header, null).dmarc).toBe('pass');
    expect(read_email_sender_authentication(live_header, undefined).dmarc).toBe('pass');
  });
});

describe('sender_domain_is_authenticated', () => {
  it('requires a DMARC pass — SPF and DKIM alone are not enough', () => {
    expect(sender_domain_is_authenticated({ dmarc: 'none', spf: 'pass', dkim: 'pass' })).toBe(
      false,
    );
    expect(sender_domain_is_authenticated({ dmarc: 'pass', spf: 'none', dkim: 'pass' })).toBe(true);
  });
});

describe('sender_is_trusted_member', () => {
  const members = ['robin@example.com', 'otto@example.com'];

  it('trusts a member address whose domain was proven', () => {
    expect(
      sender_is_trusted_member(
        {
          from_email: 'robin@example.com',
          sender_authentication: read_email_sender_authentication(live_header),
        },
        members,
      ),
    ).toBe(true);
  });

  it('REFUSES a forged member address that failed authentication', () => {
    expect(
      sender_is_trusted_member(
        {
          from_email: 'robin@example.com',
          sender_authentication: { dmarc: 'fail', spf: 'fail', dkim: 'none' },
        },
        members,
      ),
    ).toBe(false);
  });

  it('REFUSES a member address when no verdict was published at all', () => {
    expect(
      sender_is_trusted_member(
        {
          from_email: 'robin@example.com',
          sender_authentication: { dmarc: 'none', spf: 'none', dkim: 'none' },
        },
        members,
      ),
    ).toBe(false);
  });

  it('refuses a non-member even with a perfect DMARC pass', () => {
    expect(
      sender_is_trusted_member(
        {
          from_email: 'stranger@example.com',
          sender_authentication: { dmarc: 'pass', spf: 'pass', dkim: 'pass' },
        },
        members,
      ),
    ).toBe(false);
  });
});
