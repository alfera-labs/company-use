import { describe, expect, it } from 'vitest';
import { type ChatToolCall, merge_chat_tool_calls } from '@/components/app/chat_stream_projection';
import type { ToolCall } from '@/lib/api';

describe('a call waiting for a person, against the engine view of the same call', () => {
  it('stays one row', () => {
    const merged = merge_chat_tool_calls([our_row()], [the_engine_view()]);

    expect(merged).toHaveLength(1);
  });

  it('keeps waiting for a person rather than reading as running', () => {
    const [merged] = merge_chat_tool_calls([our_row()], [the_engine_view()]);

    expect(merged?.tool_status).toBe('awaiting_approval');
  });

  it('keeps the question id, so the row can offer Approve and Refuse', () => {
    const [merged] = merge_chat_tool_calls([our_row()], [the_engine_view()]);

    expect(merged?.tool_call_metadata?.approval_request_id).toBe('ejob_1');
  });

  it('keeps waiting even when the engine reports the call finished', () => {
    const engine_finished = { ...the_engine_view(), tool_status: 'completed' };

    const [merged] = merge_chat_tool_calls([our_row()], [engine_finished]);

    expect(merged?.tool_status).toBe('awaiting_approval');
  });

  it('finishes once the ledger says the call really ran', () => {
    const ran = { ...our_row(), tool_status: 'completed' } as unknown as ToolCall;

    const [merged] = merge_chat_tool_calls([ran], [the_engine_view()]);

    expect(merged?.tool_status).toBe('completed');
  });
});

function our_row(): ToolCall {
  return {
    tool_call_id: 'tcall_1',
    run_id: 'run_1',
    tool_name: 'math-calculate-1',
    tool_status: 'awaiting_approval',
    input_data: { expression: '21 * 2' },
    tool_call_metadata: {
      runtime_tool_call_id: 'call_000000000000000000000001',
      approval_request_id: 'ejob_1',
    },
  } as unknown as ToolCall;
}

function the_engine_view(): ChatToolCall {
  return {
    tool_call_id: 'stream:call_000000000000000000000001',
    run_id: 'run_1',
    tool_name: 'math-calculate-1',
    tool_status: 'running',
    input_data: { expression: '21 * 2' },
    tool_call_metadata: {
      source: 'chat_event',
      runtime_tool_call_id: 'call_000000000000000000000001|fc_00000000000000000000000001',
    },
  } as unknown as ChatToolCall;
}
