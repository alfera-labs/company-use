import { describe, expect, it } from 'vitest';
import { is_same_chat_message } from '@/components/app/chat_message_equality';
import type { ProjectedChatMessage } from '@/components/app/chat_stream_projection';

describe('is_same_chat_message', () => {
  it('treats a re-projection of unchanged content as the same message', () => {
    expect(is_same_chat_message(assistant_message(), assistant_message())).toBe(true);
  });

  it('sees a message whose text grew by one token', () => {
    const streamed = assistant_message();
    streamed.parts[0] = { type: 'text', text: 'The final answer is 42' };

    expect(is_same_chat_message(assistant_message(), streamed)).toBe(false);
  });

  it('sees a tool call that moved to a new state', () => {
    const completed = assistant_message();
    completed.parts[1] = { ...tool_part(), state: 'completed' };

    expect(is_same_chat_message(assistant_message(), completed)).toBe(false);
  });

  it('sees a tool call whose output arrived while its state stayed put', () => {
    const with_output = assistant_message();
    with_output.parts[1] = { ...tool_part(), output: { rows: 3 } };

    expect(is_same_chat_message(assistant_message(), with_output)).toBe(false);
  });

  it('sees a tool call whose display label was resolved from the catalog', () => {
    const with_display = assistant_message();
    with_display.parts[1] = { ...tool_part(), display: { title: 'Search Gmail' } };

    expect(is_same_chat_message(assistant_message(), with_display)).toBe(false);
  });

  it('sees a part appended to the message', () => {
    const with_extra_part = assistant_message();
    with_extra_part.parts.push({ type: 'text', text: 'And here is why.' });

    expect(is_same_chat_message(assistant_message(), with_extra_part)).toBe(false);
  });

  it('sees reasoning that finished streaming', () => {
    const streaming: ProjectedChatMessage = {
      id: 'msg_1',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'Working through it.', state: 'streaming' }],
    };
    const complete: ProjectedChatMessage = {
      id: 'msg_1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Working through it.', state: 'complete', durationMs: 900 },
      ],
    };

    expect(is_same_chat_message(streaming, complete)).toBe(false);
  });

  it('sees a Slack sender resolved onto a user message', () => {
    const without_sender: ProjectedChatMessage = {
      id: 'msg_2',
      role: 'user',
      parts: [{ type: 'text', text: 'ship it' }],
    };
    const with_sender: ProjectedChatMessage = {
      ...without_sender,
      sender: { source_actor_id: 'sac_1', display_name: 'Ada' },
      sent_time: '2026-08-02T10:00:00.000Z',
    };

    expect(is_same_chat_message(without_sender, with_sender)).toBe(false);
  });

  it('sees a running tool call print a new line of live output', () => {
    const with_new_line = assistant_message();
    with_new_line.parts[1] = { ...tool_part(), outputText: 'Compiling\nBuilt 12 modules' };

    expect(is_same_chat_message(assistant_message(), with_new_line)).toBe(false);
  });

  it('holds a tool call steady while its input and output objects keep their identity', () => {
    const input_data = { query: 'invoices' };
    const output_data = { rows: 3 };
    const build = (): ProjectedChatMessage => ({
      id: 'msg_3',
      role: 'assistant',
      parts: [{ ...tool_part(), input: input_data, output: output_data }],
    });

    expect(is_same_chat_message(build(), build())).toBe(true);
  });
});

function assistant_message(): ProjectedChatMessage {
  return {
    id: 'msg_1',
    role: 'assistant',
    run_id: 'run_1',
    parts: [{ type: 'text', text: 'The final answer is' }, tool_part()],
  };
}

function tool_part() {
  return {
    type: 'tool-search_email' as const,
    toolCallId: 'tc_1',
    toolName: 'search_email',
    state: 'running',
  };
}
