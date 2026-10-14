import {
  estimate_context_tokens_roughly,
  estimate_model_visible_message_tokens,
} from '@shared/token_estimate';
import { describe, expect, it } from 'vitest';

describe('estimate_model_visible_message_tokens', () => {
  it('prices a tool result by its model-facing text, not its stored envelope', () => {
    const huge_payload = 'x'.repeat(400_000);
    const message_content = {
      type: 'multimodal',
      parts: [
        {
          type: 'tool_result',
          tool_call_id: 'toolu_1',
          result: { ok: true, content_text: '{"size":3163235}', content_json: huge_payload },
        },
      ],
    };

    const estimate = estimate_model_visible_message_tokens(message_content);
    expect(estimate).toBeLessThan(100);
    expect(estimate_context_tokens_roughly(message_content)).toBeGreaterThan(100_000);
  });

  it('caps an oversized tool-result text at the model-visible bound', () => {
    const message_content = {
      type: 'multimodal',
      parts: [
        {
          type: 'tool_result',
          tool_call_id: 'toolu_1',
          result: { ok: true, content_text: 'y'.repeat(400_000) },
        },
      ],
    };

    expect(estimate_model_visible_message_tokens(message_content)).toBe(4_000);
  });

  it('falls back to the rough estimate for a message without parts', () => {
    const message_content = { type: 'text', text: 'hello there' };
    expect(estimate_model_visible_message_tokens(message_content)).toBe(
      estimate_context_tokens_roughly(message_content),
    );
  });
});

describe('estimate_context_tokens_roughly base64 elision', () => {
  it('elides a large base64 data field even without an image tag', () => {
    const base64_pdf = Buffer.from('pdf-bytes'.repeat(4_000)).toString('base64');
    const with_binary = { output: { size: 3_163_235, data: base64_pdf } };

    const estimate = estimate_context_tokens_roughly(with_binary);
    expect(estimate).toBeLessThan(100);
  });

  it('keeps ordinary prose data fields intact', () => {
    const prose = { data: 'a perfectly normal sentence with punctuation, spaces, and words.' };
    expect(estimate_context_tokens_roughly(prose)).toBeGreaterThan(10);
  });
});

describe('estimate_model_visible_message_tokens image accounting', () => {
  const image_tokens = 1_200;

  function generate_tool_result_with_images(image_count: number) {
    return {
      parts: [
        {
          type: 'tool_result',
          result: {
            ok: true,
            content_text: '',
            content: [
              { type: 'text', text: '' },
              ...Array.from({ length: image_count }, () => ({
                type: 'image',
                mime_type: 'image/png',
                data: 'A'.repeat(500_000),
              })),
            ],
          },
        },
      ],
    };
  }

  it('prices the image a tool result carries, not just its text', () => {
    expect(estimate_model_visible_message_tokens(generate_tool_result_with_images(1))).toBe(
      image_tokens,
    );
  });

  it('prices every image in a result that returned several', () => {
    expect(estimate_model_visible_message_tokens(generate_tool_result_with_images(3))).toBe(
      3 * image_tokens,
    );
  });

  it('adds the image cost on top of the result text', () => {
    const message_content = {
      parts: [
        {
          type: 'tool_result',
          result: {
            ok: true,
            content_text: 'x'.repeat(400),
            content: [{ type: 'image', mime_type: 'image/png', data: 'A'.repeat(500_000) }],
          },
        },
      ],
    };

    expect(estimate_model_visible_message_tokens(message_content)).toBe(100 + image_tokens);
  });

  it('prices a bare image part', () => {
    const message_content = {
      parts: [{ type: 'image', mime_type: 'image/png', data: 'A'.repeat(500_000) }],
    };

    expect(estimate_model_visible_message_tokens(message_content)).toBe(image_tokens);
  });

  it('leaves an image-free tool result unchanged', () => {
    const message_content = {
      parts: [{ type: 'tool_result', result: { ok: true, content_text: 'x'.repeat(400) } }],
    };

    expect(estimate_model_visible_message_tokens(message_content)).toBe(100);
  });
});
