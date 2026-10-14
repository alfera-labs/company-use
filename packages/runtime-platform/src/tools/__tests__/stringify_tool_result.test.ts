import { stringify_tool_result } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it } from 'vitest';

describe('stringify_tool_result', () => {
  it('returns small results whole', () => {
    const result = { items: ['a', 'b'], cursor: 'next' };
    expect(stringify_tool_result(result)).toBe(JSON.stringify(result));
  });

  it('bounds an oversized result with an honest marker and keeps head and tail', () => {
    const result = {
      first_field: 'HEAD_MARKER',
      bulk: 'x'.repeat(40_000),
      cursor: 'TAIL_CURSOR_MARKER',
    };
    const text = stringify_tool_result(result);

    expect(text.length).toBeLessThan(20_000);
    expect(text).toContain('HEAD_MARKER');
    expect(text).toContain('TAIL_CURSOR_MARKER');
    expect(text).toContain('characters omitted');
    expect(text).toContain('output_fields');
  });
});
