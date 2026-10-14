import { find_tool_call_subjects, tool_call_subject_policy_id } from '@shared/tool_call_subjects';
import { describe, expect, it } from 'vitest';

describe('find_tool_call_subjects', () => {
  it('finds the website a search tool is about to open', () => {
    expect(find_tool_call_subjects({ url: 'https://www.example-salons.com/saloni/x/' })).toEqual([
      {
        kind: 'website',
        grain: 'any_action',
        value: 'example-salons.com',
        display_name: 'www.example-salons.com',
      },
    ]);
  });

  it('finds the same website in a curl-shaped call under another field name', () => {
    expect(
      find_tool_call_subjects({ method: 'GET', endpoint: 'https://example-salons.com/x' }),
    ).toEqual([
      {
        kind: 'website',
        grain: 'any_action',
        value: 'example-salons.com',
        display_name: 'example-salons.com',
      },
    ]);
  });

  it('reads www and bare host as one permission', () => {
    const [with_www] = find_tool_call_subjects({ url: 'https://www.acme.com/a' });
    const [without_www] = find_tool_call_subjects({ url: 'https://acme.com/b' });
    expect(with_www?.value).toBe(without_www?.value);
  });

  it('finds a website nested inside a request body', () => {
    const subjects = find_tool_call_subjects({
      request: { headers: {}, targets: ['https://api.stripe.com/v1/refunds'] },
    });
    expect(subjects.map((subject) => subject.value)).toEqual(['api.stripe.com']);
  });

  it('reads a recipient only from a field that says it is one', () => {
    expect(find_tool_call_subjects({ to: 'anna@acme.com' })).toEqual([
      {
        kind: 'recipient',
        grain: 'this_action',
        value: 'anna@acme.com',
        display_name: 'anna@acme.com',
      },
    ]);
  });

  it('ignores an address that is only being written about', () => {
    expect(find_tool_call_subjects({ body: 'forward this to anna@acme.com please' })).toEqual([]);
  });

  it('names the program a command runs, not the whole line', () => {
    expect(find_tool_call_subjects({ command: 'rm -rf ./build' })).toEqual([
      { kind: 'command', grain: 'this_action', value: 'rm', display_name: 'rm' },
    ]);
  });

  it('finds every subject a single call has', () => {
    const subjects = find_tool_call_subjects({
      to: 'anna@acme.com',
      attachment_url: 'https://docs.acme.com/pricing.pdf',
    });
    expect(subjects.map((subject) => subject.kind).sort()).toEqual(['recipient', 'website']);
  });

  it('ignores a link that is only being written about', () => {
    expect(find_tool_call_subjects({ body: 'see https://docs.acme.com/pricing' })).toEqual([]);
  });

  it('says the same subject once however often it appears', () => {
    const subjects = find_tool_call_subjects({
      url: 'https://acme.com/a',
      fallback_url: 'https://acme.com/b',
    });
    expect(subjects).toHaveLength(1);
  });

  it('finds nothing in a call that is about nothing outside itself', () => {
    expect(find_tool_call_subjects({ expression: '21 * 2', decimal_places: 40 })).toEqual([]);
  });

  it('finds nothing when there are no arguments at all', () => {
    expect(find_tool_call_subjects(undefined)).toEqual([]);
    expect(find_tool_call_subjects(null)).toEqual([]);
  });

  it('ignores a value that only looks like a link', () => {
    expect(find_tool_call_subjects({ url: 'not a url', q: 'ftp://x.com' })).toEqual([]);
  });

  it('is about the recipient, not a link that happens to ride along', () => {
    const [first] = find_tool_call_subjects({
      to: 'anna@acme.com',
      subject: 'Your refund for order 4471',
      attachment_url: 'https://docs.acme.com/receipt.pdf',
    });
    expect(first).toMatchObject({ kind: 'recipient', value: 'anna@acme.com' });
  });
});

describe('what a permission about a subject covers', () => {
  const only_subject = (input: unknown) => {
    const [subject] = find_tool_call_subjects(input);
    if (!subject) throw new Error('expected a subject');
    return subject;
  };

  it('ties a recipient to the action it was granted for', () => {
    const recipient = only_subject({ to: 'anna@acme.com' });
    expect(recipient.grain).toBe('this_action');
    expect(tool_call_subject_policy_id(recipient, 'gmail-send_email-1')).toBe(
      'gmail-send_email-1/recipient:anna@acme.com',
    );
  });

  it('gives the same recipient a different permission under a different tool', () => {
    const recipient = only_subject({ to: 'anna@acme.com' });
    expect(tool_call_subject_policy_id(recipient, 'admin-delete_user-1')).not.toBe(
      tool_call_subject_policy_id(recipient, 'gmail-send_email-1'),
    );
  });

  it('lets a website stand on its own, whichever tool reaches it', () => {
    const website = only_subject({ url: 'https://www.example-salons.com/x' });
    expect(website.grain).toBe('any_action');
    expect(tool_call_subject_policy_id(website, 'web-fetch_page-1')).toBe(
      'website:example-salons.com',
    );
    expect(tool_call_subject_policy_id(website, 'web-screenshot-1')).toBe(
      'website:example-salons.com',
    );
  });
});
