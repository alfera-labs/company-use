import {
  evaluate_value_expression,
  fill_path_template,
  ValueExpressionError,
} from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const scope = {
  input: { thread_id: 'thr 01', cursor: 'cur_02', tags: ['a', 'b'] },
  response: {
    echoed: [
      { id: 'itm_01', value: 'first' },
      { id: 'itm_02', value: 'second' },
    ],
    next_cursor: null,
  },
};

describe('evaluate_value_expression', () => {
  it('passes plain JSON through untouched', () => {
    expect(evaluate_value_expression({ a: 1, b: ['x', true, null] }, scope)).toEqual({
      a: 1,
      b: ['x', true, null],
    });
  });

  it('reads a dotted path with $', () => {
    expect(evaluate_value_expression({ $: 'input.thread_id' }, scope)).toBe('thr 01');
    expect(evaluate_value_expression({ $: 'response.echoed.0.id' }, scope)).toBe('itm_01');
  });

  it('answers undefined for a path that is not there', () => {
    expect(evaluate_value_expression({ $: 'input.missing.deeper' }, scope)).toBeUndefined();
  });

  it('drops an object key whose value came out undefined', () => {
    expect(evaluate_value_expression({ kept: 1, gone: { $: 'input.missing' } }, scope)).toEqual({
      kept: 1,
    });
  });

  it('reshapes an array with $map, the batch law written as data', () => {
    const mapped = evaluate_value_expression(
      {
        $map: {
          from: { $: 'response.echoed' },
          to: { id: { $: 'item.id' }, text: { $: 'item.value' } },
        },
      },
      scope,
    );
    expect(mapped).toEqual([
      { id: 'itm_01', text: 'first' },
      { id: 'itm_02', text: 'second' },
    ]);
  });

  it('maps an absent array to an empty one', () => {
    expect(
      evaluate_value_expression({ $map: { from: { $: 'response.nothing' }, to: 1 } }, scope),
    ).toEqual([]);
  });

  it('lets $map read the item it maps from as parent', () => {
    const mapped = evaluate_value_expression(
      {
        $map: {
          from: { $: 'item.files' },
          to: { id: { $: 'item.name' }, owner: { $: 'parent.id' } },
        },
      },
      { item: { id: 'mail-1', files: [{ name: 'a.pdf' }] } },
    );
    expect(mapped).toEqual([{ id: 'a.pdf', owner: 'mail-1' }]);
  });

  it('refuses to map over a value that is not an array', () => {
    expect(() =>
      evaluate_value_expression({ $map: { from: 'response.echoed', to: 1 } }, scope),
    ).toThrow(ValueExpressionError);
  });

  it('takes the first value that is neither undefined nor null with $default', () => {
    expect(
      evaluate_value_expression({ $default: [{ $: 'response.next_cursor' }, null] }, scope),
    ).toBeNull();
    expect(
      evaluate_value_expression({ $default: [{ $: 'input.cursor' }, 'fallback'] }, scope),
    ).toBe('cur_02');
    expect(
      evaluate_value_expression({ $default: [{ $: 'input.missing' }, 'fallback'] }, scope),
    ).toBe('fallback');
  });

  it('stops evaluating inside $literal, so a $ key can be sent to a provider', () => {
    expect(evaluate_value_expression({ $literal: { $gt: 3 } }, scope)).toEqual({ $gt: 3 });
  });

  it('refuses an operator nobody implements instead of treating it as data', () => {
    expect(() => evaluate_value_expression({ $mpa: 1 }, scope)).toThrow('Unknown value expression');
  });

  it('refuses an operator sharing its record with other keys', () => {
    expect(() => evaluate_value_expression({ $: 'input.cursor', extra: 1 }, scope)).toThrow(
      'must have no other keys',
    );
  });
});

describe('fill_path_template', () => {
  it('substitutes a placeholder and url-encodes it', () => {
    expect(fill_path_template('/threads/{input.thread_id}/messages', scope)).toBe(
      '/threads/thr%2001/messages',
    );
  });

  it('leaves a path with no placeholder alone', () => {
    expect(fill_path_template('/echo', scope)).toBe('/echo');
  });

  it('refuses to build a url with a hole in it', () => {
    expect(() => fill_path_template('/threads/{input.missing}', scope)).toThrow(
      'has no value in this call',
    );
  });
});
