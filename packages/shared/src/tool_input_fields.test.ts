import { read_tool_input_fields } from '@shared/tool_input_fields';
import { describe, expect, it } from 'vitest';

describe('what a person reads before approving', () => {
  it('labels fields the way the tool names them', () => {
    expect(
      read_tool_input_fields(
        { to: 'anna@acme.com', schema_id: 'sch_1' },
        { properties: { to: { title: 'To' } } },
      ),
    ).toEqual([{ key: 'to', label: 'To', value: 'anna@acme.com', is_long: false }]);
  });

  it('leaves out the plumbing nobody chose', () => {
    const fields = read_tool_input_fields({ path: 'a.txt', stash_id: 'x', schema_id: 'y' });

    expect(fields.map((field) => field.key)).toEqual(['path']);
  });

  it('reads an amount as money, not as two rows', () => {
    const fields = read_tool_input_fields({ amount: 240, currency: 'GBP', order_id: '4471' });

    expect(fields.map((field) => field.value)).toContain('£240.00');
    expect(fields.map((field) => field.key)).not.toContain('currency');
  });

  it('understands an amount given in minor units', () => {
    const fields = read_tool_input_fields({ amount_pennies: 24000, currency: 'GBP' });

    expect(fields[0]?.value).toBe('£240.00');
  });

  it('keeps the amount readable when the currency code is one nobody has a symbol for', () => {
    const fields = read_tool_input_fields({ amount: 240, currency: 'ZZZ' });

    expect(fields[0]?.value).toContain('240');
    expect(fields[0]?.value).toContain('ZZZ');
  });

  it('marks a long value so it reads as a block rather than a clipped line', () => {
    const body = 'Hi Anna,\nYour refund is on its way.';

    expect(read_tool_input_fields({ body })[0]?.is_long).toBe(true);
  });
});

describe('showing the call and not the machinery', () => {
  it('shows only the fields the tool named, in the order it named them', () => {
    const fields = read_tool_input_fields(
      { query: 'opening times', topic: 'general', provider: 'auto', max_results: 6 },
      { properties: { query: { title: 'Query' } } },
      ['query'],
    );

    expect(fields).toEqual([
      { key: 'query', label: 'Query', value: 'opening times', is_long: false },
    ]);
  });

  it('keeps the order the tool named rather than the order of the call', () => {
    const fields = read_tool_input_fields({ channel_id: 'C1', message: 'hello' }, undefined, [
      'message',
      'channel_id',
    ]);

    expect(fields.map((field) => field.key)).toEqual(['message', 'channel_id']);
  });

  it('says nothing about a named field the call did not set', () => {
    const fields = read_tool_input_fields({ file_path: 'report.pdf' }, undefined, [
      'file_path',
      'initial_comment',
    ]);

    expect(fields.map((field) => field.key)).toEqual(['file_path']);
  });

  it('drops a value the tool filled in itself when nothing was named', () => {
    const fields = read_tool_input_fields(
      { expression: '2 + 2', decimal_places: 40 },
      { properties: { decimal_places: { default: 40 } } },
    );

    expect(fields.map((field) => field.key)).toEqual(['expression']);
  });

  it('keeps a value that only looks like the default', () => {
    const fields = read_tool_input_fields(
      { expression: '2 + 2', decimal_places: 2 },
      { properties: { decimal_places: { default: 40 } } },
    );

    expect(fields.map((field) => field.key)).toEqual(['decimal_places', 'expression']);
  });

  it('stops at four lines when nothing named which ones matter', () => {
    const fields = read_tool_input_fields({ a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' });

    expect(fields.map((field) => field.key)).toEqual(['a', 'b', 'c', 'd']);
  });
});
