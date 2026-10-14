import { estimate_message_tokens } from '@runtime-platform/orchestrator/context/token_estimation';
import { describe, expect, it } from 'vitest';

const image_tokens = 1_200;

function generate_image_message(stamp: number | null) {
  return {
    token_count: stamp,
    message_content: {
      parts: [
        {
          type: 'tool_result',
          result: {
            ok: true,
            content_text: '',
            content: [{ type: 'image', mime_type: 'image/png', data: 'A'.repeat(500_000) }],
          },
        },
      ],
    },
  };
}

describe('estimate_message_tokens', () => {
  it('reprices a row whose stamp predates image pricing', () => {
    expect(estimate_message_tokens(generate_image_message(15))).toBe(image_tokens);
  });

  it('reprices a row stamped far too high', () => {
    expect(estimate_message_tokens(generate_image_message(97_063))).toBe(image_tokens);
  });

  it('prices the content when there is no stamp at all', () => {
    expect(estimate_message_tokens(generate_image_message(null))).toBe(image_tokens);
  });

  it('falls back to the stamp when the content was not loaded', () => {
    expect(estimate_message_tokens({ token_count: 4_321 })).toBe(4_321);
  });

  it('falls back to a rough estimate when there is neither content nor stamp', () => {
    expect(estimate_message_tokens({ token_count: null })).toBeGreaterThan(0);
  });

  it('prices ordinary text by its length, not by a stamp', () => {
    const message = {
      token_count: 999_999,
      message_content: { parts: [{ type: 'text', text: 'x'.repeat(400) }] },
    };

    expect(estimate_message_tokens(message)).toBeLessThan(200);
  });
});
