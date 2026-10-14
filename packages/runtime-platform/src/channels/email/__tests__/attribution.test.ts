import {
  append_email_attribution,
  email_attribution_line,
} from '@runtime-platform/channels/email/attribution';
import { describe, expect, it } from 'vitest';

describe('email_attribution_line', () => {
  it('names the workspace, dropping container words', () => {
    expect(email_attribution_line('Acme Workspace')).toBe("Sent by Acme's AI agent on Alfera.");
  });

  it('does not stack a possessive on a name that has one', () => {
    expect(email_attribution_line("Robin's Workspace")).toBe("Sent by Robin's AI agent on Alfera.");
  });

  it('gives a name ending in s the bare apostrophe', () => {
    expect(email_attribution_line('Atlas')).toBe("Sent by Atlas' AI agent on Alfera.");
  });

  it('falls back to the generic line when the name is empty', () => {
    expect(email_attribution_line(undefined)).toBe('Sent by an AI agent on Alfera.');
    expect(email_attribution_line('   ')).toBe('Sent by an AI agent on Alfera.');
  });
});

describe('append_email_attribution', () => {
  it('adds the named line when the workspace leaves attribution on', () => {
    expect(append_email_attribution('Done.', true, 'Acme')).toBe(
      "Done.\n\n— Sent by Acme's AI agent on Alfera.",
    );
  });

  it('leaves the message untouched when the workspace turns it off', () => {
    expect(append_email_attribution('Done.', false, 'Acme')).toBe('Done.');
  });

  it('does not stack a second line onto text that already carries one', () => {
    const once = append_email_attribution('Done.', true, 'Acme');
    expect(append_email_attribution(once, true, 'Acme')).toBe(once);
    const generic = append_email_attribution('Done.', true);
    expect(append_email_attribution(generic, true, 'Acme')).toBe(generic);
  });

  it('does not leave a blank gap when the message ends in whitespace', () => {
    expect(append_email_attribution('Done.\n\n', true)).toBe(
      'Done.\n\n— Sent by an AI agent on Alfera.',
    );
  });
});
