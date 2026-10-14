import type { RuntimeAgentMessagePart } from '@agent-core/messages/runtime_message';
import {
  message_content_to_runtime_parts,
  runtime_parts_to_message_content,
} from '@runtime-platform/orchestrator/runtime_message_content';
import { describe, expect, it } from 'vitest';

describe('runtime message content storage', () => {
  it('stores model-visible multimodal parts once', () => {
    const parts: RuntimeAgentMessagePart[] = [
      { type: 'text', text: 'what is this?' },
      { type: 'image', data: 'abc123', mime_type: 'image/png' },
    ];

    const content = runtime_parts_to_message_content(parts);

    expect(content).toMatchObject({
      type: 'multimodal',
      text: 'what is this?',
      parts,
    });
    expect(content.data).toBeUndefined();
    expect(message_content_to_runtime_parts(content)).toEqual(parts);
  });

  it('uses data only for runtime parts that do not have a shared part schema', () => {
    const parts: RuntimeAgentMessagePart[] = [{ type: 'json', json: { answer: 42 } }];

    const content = runtime_parts_to_message_content(parts);

    expect(content.parts).toBeUndefined();
    expect(content.data).toEqual({ content: parts });
    expect(message_content_to_runtime_parts(content)).toEqual(parts);
  });

  it('does not duplicate legacy data.content when parts are already present', () => {
    const parts = [{ type: 'text' as const, text: 'hello' }];
    const content = {
      type: 'multimodal' as const,
      text: 'hello',
      parts,
      data: { content: [...parts, { type: 'json', json: { kept: true } }] },
    };

    expect(message_content_to_runtime_parts(content)).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'json', json: { kept: true } },
    ]);
  });
});
