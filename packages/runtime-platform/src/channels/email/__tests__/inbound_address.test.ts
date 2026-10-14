import {
  build_inbound_email_address,
  default_inbound_email_username,
  generate_readable_username,
  inbound_email_username_schema,
  parse_email_address,
  read_inbound_email_username,
} from '@runtime-platform/channels/email/inbound_address';
import { describe, expect, it } from 'vitest';

describe('inbound_email_username_schema', () => {
  it('accepts and lowercases a plain username', () => {
    expect(inbound_email_username_schema.parse('Acme-Team')).toBe('acme-team');
  });

  it.each([
    'ab',
    '-starts-wrong',
    'ends-wrong-',
    'has space',
    'has@at',
  ])('rejects %s', (username) => {
    expect(inbound_email_username_schema.safeParse(username).success).toBe(false);
  });
});

describe('default_inbound_email_username', () => {
  const fallback = () => 'quiet-harbor-42';

  it('uses the workspace name a person chose', () => {
    expect(default_inbound_email_username('Acme', fallback)).toBe('acme');
  });

  it('drops trailing filler words that name the container', () => {
    expect(default_inbound_email_username('Fabrikam Workspace', fallback)).toBe('fabrikam');
    expect(default_inbound_email_username('Acme Inc', fallback)).toBe('acme');
  });

  it('keeps a filler word that is the whole name', () => {
    expect(default_inbound_email_username('Workspace', fallback)).toBe('workspace');
  });

  it('normalizes names with unsupported characters', () => {
    expect(default_inbound_email_username('Acme & Söhne!', fallback)).toBe('acme-s-hne');
  });

  it('never returns a machine identity string', () => {
    const from_name = default_inbound_email_username('Fabrikam Workspace', fallback);
    expect(from_name).not.toContain('workos');
    expect(from_name.length).toBeLessThanOrEqual(32);
  });

  it('falls back to a readable name when the workspace name is unusable or reserved', () => {
    expect(default_inbound_email_username('\u682a\u5f0f\u4f1a\u793e', fallback)).toBe(
      'quiet-harbor-42',
    );
    expect(default_inbound_email_username('...', fallback)).toBe('quiet-harbor-42');
    expect(default_inbound_email_username('support', fallback)).toBe('quiet-harbor-42');
  });

  it('never produces a candidate ending in a separator after truncation', () => {
    const long_name = `${'a'.repeat(31)} tail`;
    expect(default_inbound_email_username(long_name, fallback)).toBe('a'.repeat(31));
  });
});

describe('generate_readable_username', () => {
  it('produces a valid username a person can repeat aloud', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const generated = generate_readable_username();
      expect(generated).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
      expect(inbound_email_username_schema.safeParse(generated).success).toBe(true);
    }
  });
});

describe('build_inbound_email_address', () => {
  it('joins the username with the configured domain', () => {
    expect(build_inbound_email_address('acme')).toBe('acme@inbox.test.alfera.ai');
  });
});

describe('parse_email_address', () => {
  it('reads a display-name mailbox', () => {
    expect(parse_email_address('Ada Lovelace <Ada@Example.com>')).toEqual({
      email: 'ada@example.com',
      display_name: 'Ada Lovelace',
    });
  });

  it('reads a bare address', () => {
    expect(parse_email_address('ada@example.com')).toEqual({ email: 'ada@example.com' });
  });

  it('returns null for text without a mailbox', () => {
    expect(parse_email_address('not an address')).toBeNull();
  });
});

describe('read_inbound_email_username', () => {
  it('returns the username for an address on the managed domain', () => {
    expect(read_inbound_email_username('Acme <acme@inbox.test.alfera.ai>')).toBe('acme');
  });

  it('returns null for a foreign domain', () => {
    expect(read_inbound_email_username('acme@example.com')).toBeNull();
  });

  it('tolerates a plus suffix a sender adds, routing on the base username', () => {
    expect(read_inbound_email_username('acme+anything@inbox.test.alfera.ai')).toBe('acme');
  });
});
