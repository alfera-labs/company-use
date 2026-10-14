import type { TriggerRule } from '@coworker/core/db/schema/json_column_types';
import { apply_trigger_rules, trigger_rule_schema } from '@runtime-platform/triggers/trigger_rules';
import { describe, expect, it } from 'vitest';

const gmail_event = {
  sender: '  News@No-Reply.Example.com ',
  subject: 'Renewal 2027 — is it paid?',
  label_ids: ['INBOX', 'UNREAD'],
  thread_id: 17_003,
  payload: { headers: { 'List-Unsubscribe': '<https://example.com/u>' } },
};

function verdict(rules: TriggerRule[], data: Record<string, unknown> = gmail_event) {
  return apply_trigger_rules(rules, data);
}

describe('apply_trigger_rules', () => {
  it('passes when there are no rules at all', () => {
    expect(verdict([])).toEqual({ passed: true });
  });

  it('runs every operation against the event', () => {
    const passing: TriggerRule[] = [
      { field: 'label_ids', operation: 'equals_any_of', values: ['inbox'] },
      { field: 'sender', operation: 'is_not_any_of', values: ['me@example.com'] },
      { field: 'sender', operation: 'contains_any_of', values: ['no-reply'] },
      { field: 'subject', operation: 'does_not_contain_any_of', values: ['invoice'] },
      { field: 'subject', operation: 'is_present' },
      { field: 'payload.headers.X-Missing', operation: 'is_absent' },
    ];
    expect(verdict(passing)).toEqual({ passed: true });

    const failing: TriggerRule[] = [
      { field: 'label_ids', operation: 'equals_any_of', values: ['spam'] },
      { field: 'sender', operation: 'is_not_any_of', values: ['news@no-reply.example.com'] },
      { field: 'subject', operation: 'contains_any_of', values: ['invoice'] },
      { field: 'sender', operation: 'does_not_contain_any_of', values: ['no-reply'] },
      { field: 'payload.headers.X-Missing', operation: 'is_present' },
      { field: 'payload.headers.List-Unsubscribe', operation: 'is_absent' },
    ];
    for (const rule of failing) {
      expect(verdict([rule])).toMatchObject({ passed: false, rule });
    }
  });

  it('reads a dot path into nested objects and compares element-wise inside a list', () => {
    expect(
      verdict([
        { field: 'payload.headers.List-Unsubscribe', operation: 'contains_any_of', values: ['/u'] },
      ]),
    ).toEqual({ passed: true });
    expect(
      verdict([{ field: 'label_ids', operation: 'equals_any_of', values: ['UNREAD'] }]),
    ).toEqual({ passed: true });
    expect(verdict([{ field: 'subject.nope.deeper', operation: 'is_absent' }])).toEqual({
      passed: true,
    });
  });

  it('compares trimmed and case-insensitively, and stringifies non-string values', () => {
    expect(
      verdict([
        { field: 'sender', operation: 'equals_any_of', values: ['  NEWS@no-reply.example.com  '] },
        { field: 'thread_id', operation: 'equals_any_of', values: ['17003'] },
        {
          field: 'payload.headers',
          operation: 'contains_any_of',
          values: ['list-unsubscribe'],
        },
      ]),
    ).toEqual({ passed: true });
  });

  it('names the FIRST failing rule and says what it saw', () => {
    const result = verdict([
      { field: 'subject', operation: 'is_present' },
      { field: 'sender', operation: 'does_not_contain_any_of', values: ['no-reply', 'noreply'] },
      { field: 'subject', operation: 'is_absent' },
    ]);
    expect(result.passed).toBe(false);
    if (result.passed) throw new Error('the no-reply rule must fail');
    expect(result.rule.operation).toBe('does_not_contain_any_of');
    expect(result.reason).toContain('sender is "news@no-reply.example.com"');
    expect(result.reason).toContain('does not contain any of');
  });

  it('treats an empty string and a null as absent', () => {
    const data = { sender: '   ', subject: null };
    expect(verdict([{ field: 'sender', operation: 'is_absent' }], data)).toEqual({ passed: true });
    expect(verdict([{ field: 'subject', operation: 'is_present' }], data)).toMatchObject({
      passed: false,
    });
  });

  it('compares an address whole, so a lookalike domain never counts as our own mail', () => {
    const own = ['owner0@example.com'];
    const mine = { sender: 'Site Owner <Owner0@example.com>' };
    const lookalike = { sender: 'owner0@example.com.lookalike.example.net' };

    expect(
      verdict([{ field: 'sender', operation: 'address_is_any_of', values: own }], mine),
    ).toEqual({
      passed: true,
    });
    expect(
      verdict([{ field: 'sender', operation: 'address_is_not_any_of', values: own }], mine),
    ).toMatchObject({ passed: false });
    expect(
      verdict([{ field: 'sender', operation: 'address_is_not_any_of', values: own }], lookalike),
    ).toEqual({ passed: true });
  });

  it('reads headers from a provider list and from a flat map, by name and case-insensitively', () => {
    const gmail_shape = {
      payload: {
        headers: [
          { name: 'List-Unsubscribe', value: '<https://x/u>' },
          { name: 'To', value: 'a@example.com' },
        ],
      },
    };
    const flat_shape = { headers: { 'list-unsubscribe': '<https://x/u>' } };
    const newsletter_rule = {
      field: 'payload.headers',
      operation: 'header_missing' as const,
      values: ['List-Unsubscribe'],
    };

    for (const data of [gmail_shape, flat_shape]) {
      expect(verdict([newsletter_rule], data)).toMatchObject({ passed: false });
      expect(verdict([{ ...newsletter_rule, operation: 'header_present' as const }], data)).toEqual(
        { passed: true },
      );
    }
    expect(
      verdict([newsletter_rule], {
        payload: { headers: [{ name: 'To', value: 'a@example.com' }] },
      }),
    ).toEqual({
      passed: true,
    });
  });

  it('exports a strict rule schema for the trigger tools', () => {
    expect(trigger_rule_schema.parse({ field: 'sender', operation: 'is_present' })).toEqual({
      field: 'sender',
      operation: 'is_present',
    });
    expect(
      trigger_rule_schema.safeParse({ field: 'sender', operation: 'shouts_at', values: [] })
        .success,
    ).toBe(false);
    expect(
      trigger_rule_schema.safeParse({ field: 'sender', operation: 'is_present', extra: 1 }).success,
    ).toBe(false);
  });
});

describe('a failed check, as the history reads it', () => {
  it('shows a glimpse of a long value and counts the rest, never the whole block', () => {
    const headers = Array.from({ length: 40 }, (_, i) => ({
      name: `h${i}`,
      value: 'x'.repeat(200),
    }));
    const result = apply_trigger_rules(
      [{ field: 'payload.headers', operation: 'contains_any_of', values: ['x-mailer'] }],
      { payload: { headers } },
    );
    expect(result.passed).toBe(false);
    if (result.passed) return;
    expect(result.reason.length).toBeLessThan(400);
    expect(result.reason).toContain('and 37 more');
    expect(result.reason).toContain('which fails contains any of: x-mailer');
  });
});
