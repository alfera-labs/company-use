import { message_content_schema } from '@shared/runtime';
import { describe, expect, it } from 'vitest';

describe('message_content_schema', () => {
  it('accepts first-class tool result parts', () => {
    expect(() =>
      message_content_schema.parse({
        type: 'tool_result',
        text: '{"found":true}',
        parts: [
          {
            type: 'tool_result',
            tool_call_id: 'tool_1',
            tool_name: 'runtime-search_context-1',
            result: {
              ok: true,
              content_json: { found: true },
            },
          },
        ],
      }),
    ).not.toThrow();
  });
});
