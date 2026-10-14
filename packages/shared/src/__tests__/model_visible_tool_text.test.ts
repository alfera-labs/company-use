import {
  cap_model_visible_tool_text,
  cap_strings_in_tool_payload,
  model_visible_tool_text_head_chars,
  model_visible_tool_text_limit_chars,
  model_visible_tool_text_tail_chars,
} from '@shared/model_visible_tool_text';
import { describe, expect, it } from 'vitest';

describe('cap_model_visible_tool_text', () => {
  it('returns text under the limit by reference', () => {
    const text = 'x'.repeat(model_visible_tool_text_limit_chars - 1);

    expect(cap_model_visible_tool_text(text)).toBe(text);
  });

  it('returns text exactly at the limit whole', () => {
    const text = 'x'.repeat(model_visible_tool_text_limit_chars);

    expect(cap_model_visible_tool_text(text)).toBe(text);
  });

  it('keeps the head and the tail of text one character over the limit', () => {
    const text = `HEAD${'x'.repeat(model_visible_tool_text_limit_chars - 7)}TAIL`;
    const capped = cap_model_visible_tool_text(text);

    expect(capped.startsWith('HEAD')).toBe(true);
    expect(capped.endsWith('TAIL\n')).toBe(false);
    expect(capped).toContain('TAIL');
    expect(capped).toContain('1 of 16001 characters omitted from the middle');
  });

  it('keeps exactly the head and tail budgets and states the true loss', () => {
    const text = 'x'.repeat(500_000);
    const capped = cap_model_visible_tool_text(text);
    const omitted =
      500_000 - model_visible_tool_text_head_chars - model_visible_tool_text_tail_chars;

    expect(capped).toContain(`${omitted} of 500000 characters omitted from the middle`);
    expect(capped.length).toBeLessThan(model_visible_tool_text_limit_chars + 300);
  });
});

describe('cap_strings_in_tool_payload', () => {
  it('returns an untouched payload by reference, all the way down', () => {
    const payload = { files: [{ name: 'a.txt', body: 'short' }], cursor: null };

    expect(cap_strings_in_tool_payload(payload)).toBe(payload);
    expect(cap_strings_in_tool_payload(payload).files).toBe(payload.files);
  });

  it('caps only the oversized string and shares the rest of the structure', () => {
    const untouched_sibling = { name: 'b.txt', body: 'short' };
    const payload = { files: [{ name: 'a.txt', body: 'x'.repeat(400_000) }, untouched_sibling] };
    const capped = cap_strings_in_tool_payload(payload);

    expect(capped).not.toBe(payload);
    expect(capped.files[1]).toBe(untouched_sibling);
    expect(capped.files[0]?.body).toContain('characters omitted from the middle');
    expect(payload.files[0]?.body.length).toBe(400_000);
  });

  it('leaves non-string leaves alone', () => {
    const payload = { count: 3, ok: true, missing: null, nested: { at: undefined } };

    expect(cap_strings_in_tool_payload(payload)).toBe(payload);
  });
});
