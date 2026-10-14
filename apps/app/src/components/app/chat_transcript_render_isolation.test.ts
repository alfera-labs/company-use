import { describe, expect, it } from 'vitest';
import { message_part_identity } from '@/components/app/chat_conversation';
import { is_same_chat_message } from '@/components/app/chat_message_equality';
import {
  apply_chat_stream_event_to_thread,
  type ChatToolCall,
  chat_thread_assistant_message_items,
  create_empty_chat_thread_projection,
  create_projected_chat_messages,
  merge_chat_tool_calls,
  type ProjectedChatMessage,
} from '@/components/app/chat_stream_projection';
import type { ChatStreamEvent, RunMessage, ToolCall } from '@/lib/api';

describe('transcript render isolation', () => {
  it('changes no rows when a long chat is re-projected from unchanged data', () => {
    const transcript = create_long_transcript(60);
    const before = project(transcript);
    const after = project(transcript);

    expect(before).toHaveLength(121);
    expect(before.every((message, index) => message !== after[index])).toBe(true);

    expect(find_changed_rows(before, after)).toEqual([]);
  });

  it('changes only the streaming row when one token arrives', () => {
    const transcript = create_long_transcript(60);
    const before = project({ ...transcript, live_thread: streamed_thread('Here is the ') });
    const after = project({ ...transcript, live_thread: streamed_thread('Here is the answer') });

    const changed_rows = find_changed_rows(before, after);

    expect(changed_rows).toHaveLength(1);
    expect(changed_rows[0]).toBe(after.length - 1);
  });

  it('changes no rows when a tool call is merged again from the same data', () => {
    const persisted_tool_calls = [persisted_tool_call('tc_1'), persisted_tool_call('tc_2')];
    const transcript = create_long_transcript(20);

    const changed_rows = find_changed_rows(
      project({ ...transcript, persisted_tool_calls }),
      project({ ...transcript, persisted_tool_calls }),
    );

    expect(changed_rows).toEqual([]);
  });
});

describe('tool identity across the live→persisted seam', () => {
  const live_part = tool_part({ tool_call_id: 'run_live:tool:toolu_01', runtime_id: 'toolu_01' });
  const persisted_part = tool_part({ tool_call_id: 'tcall_01', runtime_id: 'toolu_01' });

  it('keeps one identity when the same call swaps its raw id', () => {
    expect(message_part_identity(persisted_part)).toBe(message_part_identity(live_part));
  });

  it('reports "same" to the memo comparator when only the raw id changed', () => {
    expect(
      is_same_chat_message(one_part_message(live_part), one_part_message(persisted_part)),
    ).toBe(true);
  });

  it('keeps an expansion-state entry keyed by that identity', () => {
    const expanded_by_key = new Map([[message_part_identity(live_part), true]]);

    expect(expanded_by_key.get(message_part_identity(persisted_part))).toBe(true);
  });

  it('gives a genuinely different call a different identity', () => {
    const other_call = tool_part({ tool_call_id: 'tcall_02', runtime_id: 'toolu_02' });
    const no_runtime_id = tool_part({ tool_call_id: 'tcall_03' });

    expect(message_part_identity(other_call)).not.toBe(message_part_identity(persisted_part));
    expect(message_part_identity(no_runtime_id)).toBe('tool-gmail-find_email:tcall_03');
    expect(is_same_chat_message(one_part_message(live_part), one_part_message(other_call))).toBe(
      false,
    );
  });

  it('projects the runtime id as the canonical key from both sides of the seam', () => {
    const [live] = create_projected_chat_messages({
      active_run_id: 'run_live',
      messages: [],
      tool_calls: [live_tool_call()],
    });
    const [persisted] = create_projected_chat_messages({
      messages: [tool_result_message()],
      tool_calls: [merged_tool_call()],
    });

    expect(part_identities(live)).toEqual(['tool-gmail-find_email:toolu_01']);
    expect(part_identities(persisted)).toEqual(['tool-gmail-find_email:toolu_01']);
  });

  function tool_part(input: { tool_call_id: string; runtime_id?: string }) {
    return {
      type: 'tool-gmail-find_email' as const,
      toolCallId: input.tool_call_id,
      ...(input.runtime_id ? { canonicalId: input.runtime_id } : {}),
      toolName: 'gmail-find_email',
      state: 'completed',
    };
  }

  function one_part_message(part: ReturnType<typeof tool_part>): ProjectedChatMessage {
    return { id: 'msg_assistant', role: 'assistant', run_id: 'run_live', parts: [part] };
  }
});

function part_identities(message: ProjectedChatMessage | undefined) {
  return (message?.parts ?? []).map(message_part_identity);
}

function live_tool_call(): ChatToolCall {
  return {
    input_data: { q: 'is:unread' },
    run_id: 'run_live',
    tool_call_id: 'run_live:tool:toolu_01',
    tool_call_metadata: { runtime_tool_call_id: 'toolu_01' },
    tool_name: 'gmail-find_email',
    tool_status: 'completed',
  };
}

function merged_tool_call(): ChatToolCall {
  return {
    input_data: { q: 'is:unread' },
    run_id: 'run_live',
    tool_call_id: 'tcall_01',
    tool_call_metadata: { runtime_tool_call_id: 'toolu_01' },
    tool_name: 'gmail-find_email',
    tool_status: 'completed',
  };
}

function tool_result_message(): RunMessage {
  return {
    created_time: '2026-06-16T00:00:00.000Z',
    is_user_visible: false,
    message_content: { text: '3 unread' },
    message_role: 'tool_result',
    message_sequence: 1,
    run_id: 'run_live',
    run_message_id: 'msg_tool_result',
    tool_call_id: 'tcall_01',
  } as unknown as RunMessage;
}

type Transcript = {
  live_thread?: ReturnType<typeof streamed_thread>;
  messages: RunMessage[];
  persisted_tool_calls?: ToolCall[];
};

function project(transcript: Transcript): ProjectedChatMessage[] {
  return create_projected_chat_messages({
    active_run_id: 'run_live',
    assistant_message_items: chat_thread_assistant_message_items(transcript.live_thread),
    messages: transcript.messages,
    tool_calls: merge_chat_tool_calls(transcript.persisted_tool_calls ?? [], []),
  });
}

function find_changed_rows(before: ProjectedChatMessage[], after: ProjectedChatMessage[]) {
  const changed_rows: number[] = [];
  const row_count = Math.max(before.length, after.length);

  for (let index = 0; index < row_count; index += 1) {
    const before_row = before[index];
    const after_row = after[index];
    if (!before_row || !after_row || !is_same_chat_message(before_row, after_row)) {
      changed_rows.push(index);
    }
  }
  return changed_rows;
}

function create_long_transcript(turn_count: number): Transcript {
  const messages: RunMessage[] = [];
  for (let turn = 0; turn < turn_count; turn += 1) {
    messages.push(
      chat_message({
        message_role: 'user',
        run_message_id: `msg_user_${turn}`,
        sequence: turn * 2,
        text: `Question number ${turn}.`,
      }),
      chat_message({
        message_role: 'assistant',
        run_message_id: `msg_assistant_${turn}`,
        run_id: `run_${turn}`,
        sequence: turn * 2 + 1,
        text: `Answer number ${turn}, with **markdown** and a list.`,
      }),
    );
  }
  messages.push(
    chat_message({
      message_role: 'user',
      run_id: 'run_live',
      run_message_id: 'msg_user_live',
      sequence: turn_count * 2,
      text: 'And one last question.',
    }),
  );
  return { messages };
}

function streamed_thread(text: string) {
  const started = apply_chat_stream_event_to_thread(
    create_empty_chat_thread_projection(),
    assistant_started_event(),
  );
  return apply_chat_stream_event_to_thread(started, assistant_delta_event(text));
}

function assistant_started_event(): ChatStreamEvent {
  return {
    ...base_chat_event('evt_start', 'item_started', 1),
    item: {
      item_id: 'run_live:assistant:0',
      run_id: 'run_live',
      item_type: 'assistant_message',
      item_status: 'streaming',
      item_sequence: 1,
      parts: [{ type: 'text', text: '' }],
      created_time: '2026-06-16T00:00:00.000Z',
      last_updated_time: '2026-06-16T00:00:00.000Z',
    },
  } as unknown as ChatStreamEvent;
}

function assistant_delta_event(text: string): ChatStreamEvent {
  return {
    ...base_chat_event(`evt_delta_${text.length}`, 'item_delta', 2),
    item_id: 'run_live:assistant:0',
    delta: { delta_type: 'text_delta', text },
  } as unknown as ChatStreamEvent;
}

function base_chat_event(event_id: string, event_type: string, sequence: number) {
  return {
    event_id,
    workspace_id: 'wsp_1',
    session_id: 'ses_1',
    run_id: 'run_live',
    sequence,
    event_type,
    occurred_time: '2026-06-16T00:00:00.000Z',
    source: { source_type: 'runtime_event', runtime_event_id: event_id },
  };
}

function persisted_tool_call(tool_call_id: string): ToolCall {
  return {
    input_data: { q: 'is:unread' },
    run_id: 'run_1',
    tool_call_id,
    tool_name: 'gmail-find_email',
    tool_status: 'completed',
  } as unknown as ToolCall;
}

function chat_message(input: {
  message_role: 'assistant' | 'user';
  run_id?: string;
  run_message_id: string;
  sequence: number;
  text: string;
}): RunMessage {
  return {
    created_time: '2026-06-16T00:00:00.000Z',
    is_model_visible: true,
    is_user_visible: true,
    last_updated_time: '2026-06-16T00:00:00.000Z',
    message_content: { text: input.text, type: 'text' },
    message_kind: input.message_role === 'user' ? 'input' : 'output',
    message_role: input.message_role,
    message_sequence: input.sequence,
    run_id: input.run_id,
    run_message_id: input.run_message_id,
    run_message_sequence: input.sequence,
    session_id: 'ses_1',
    workspace_id: 'wsp_1',
  } as unknown as RunMessage;
}
