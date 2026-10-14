import { estimate_pi_context_tokens } from '@agent-core/engines/pi/pi_compaction';
import { empty_usage } from '@agent-core/engines/pi/pi_messages';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

describe('estimate_pi_context_tokens', () => {
  it('reports the provider usage, not a characters/4 sum of the transcript', () => {
    const tool_result_chars = 400_000;
    const messages: AgentMessage[] = [
      user_message('summarise the research'),
      tool_result_message('x'.repeat(tool_result_chars)),
      assistant_message_with_usage(300_000),
    ];

    const characters_over_four = Math.ceil(tool_result_chars / 4);
    expect(characters_over_four).toBe(100_000);

    expect(estimate_pi_context_tokens(messages)).toBe(300_000);
  });

  it('adds the messages that arrived after the last reported usage', () => {
    const trailing_chars = 40_000;
    const messages: AgentMessage[] = [
      assistant_message_with_usage(120_000),
      tool_result_message('y'.repeat(trailing_chars)),
    ];

    expect(estimate_pi_context_tokens(messages)).toBe(120_000 + trailing_chars / 4);
  });

  it('falls back to the heuristic when no assistant message reported usage', () => {
    const messages: AgentMessage[] = [user_message('z'.repeat(8_000))];

    expect(estimate_pi_context_tokens(messages)).toBe(2_000);
  });
});

function user_message(text: string): AgentMessage {
  return { role: 'user', content: text, timestamp: 0 } as AgentMessage;
}

function tool_result_message(text: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: 'call_1',
    toolName: 'search',
    content: [{ type: 'text', text }],
    details: {},
    isError: false,
    timestamp: 0,
  } as AgentMessage;
}

function assistant_message_with_usage(total_tokens: number): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'done' }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    usage: { ...empty_usage(), totalTokens: total_tokens },
    stopReason: 'stop',
    timestamp: 0,
  } as AgentMessage;
}
