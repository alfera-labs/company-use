import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import { bound_persisted_tool_result } from '@runtime-platform/tools/tool_result_message_content';
import { describe, expect, it } from 'vitest';

describe('bound_persisted_tool_result', () => {
  it('passes an ordinary result through untouched', () => {
    const result: RuntimeToolResult = {
      ok: true,
      content_json: { items: ['a', 'b'], cursor: 'next' },
      content_text: '{"items":["a","b"],"cursor":"next"}',
    };

    expect(bound_persisted_tool_result(result)).toBe(result);
  });

  it('replaces an oversized payload with a marker that says what was lost and where it lives', () => {
    const result: RuntimeToolResult = {
      ok: true,
      content_json: { attachment: 'x'.repeat(300_000) },
      content_text: 'short model-visible text',
    };

    const bounded = bound_persisted_tool_result(result);

    expect(bounded.ok).toBe(true);
    if (!bounded.ok) throw new Error('expected an ok result');
    const payload = bounded.content_json as Record<string, unknown>;
    expect(payload.persisted_truncated).toBe(true);
    expect(payload.original_chars).toBeGreaterThan(300_000);
    expect(String(payload.note)).toContain('/v1/tool-calls/');
    expect(JSON.stringify(bounded).length).toBeLessThan(140_000);
  });

  it('leaves the model-visible text alone, because that is what a person reads', () => {
    const result: RuntimeToolResult = {
      ok: true,
      content_json: { attachment: 'x'.repeat(300_000) },
      content_text: 'the sixteen-thousand-char text the model actually saw',
    };

    const bounded = bound_persisted_tool_result(result);

    expect(bounded.ok).toBe(true);
    if (!bounded.ok) throw new Error('expected an ok result');
    expect(bounded.content_text).toBe('the sixteen-thousand-char text the model actually saw');
  });

  it('leaves a result with no model-visible text whole, because the model reads its json', () => {
    const result: RuntimeToolResult = {
      ok: true,
      content_json: { attachment: 'x'.repeat(300_000) },
    };

    expect(bound_persisted_tool_result(result)).toBe(result);
  });

  it('never rewrites a failure, so an error stays diagnosable', () => {
    const result: RuntimeToolResult = {
      ok: false,
      error_code: 'tool_execution_failed',
      error_message: 'boom',
    };

    expect(bound_persisted_tool_result(result)).toBe(result);
  });
});
