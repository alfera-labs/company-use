import { read_tool_input_fields } from '@coworker/shared';
import { describe, expect, it } from 'vitest';
import {
  type ChatToolCall,
  create_projected_chat_messages,
  is_chat_tool_part,
  merge_chat_tool_calls,
  type ProjectedChatMessagePart,
} from '@/components/app/chat_stream_projection';
import { split_settled_run } from '@/components/app/settled_run_fold';
import type { CatalogNode, RunMessage, ToolCall } from '@/lib/api';

describe('a step waiting for a person, in the chat', () => {
  it('reaches the transcript as a step waiting for a person, with its fields labelled', () => {
    const parts = project_waiting_step();

    const tool_part = parts.find(is_chat_tool_part);
    expect(tool_part?.state).toBe('awaiting_approval');
    expect(read_tool_input_fields(tool_part?.input, tool_part?.inputSchema)).toEqual([
      { key: 'to', label: 'To', value: 'anna@acme.com', is_long: false },
      { key: 'subject', label: 'Subject', value: 'Refund for order 4471', is_long: false },
    ]);
  });

  it('survives the engine reporting the same call as finished', () => {
    const parts = project_real_session();

    const tool_part = parts.find(is_chat_tool_part);
    expect(tool_part?.state).toBe('awaiting_approval');
    expect(tool_part?.approvalRequestId).toBe('ejob_01000000000000000000000003');
  });

  it('is never folded away behind the finished run', () => {
    const groups = [
      { type: 'internal' as const, parts: project_waiting_step(), startIndex: 0 },
      { type: 'part' as const, part: assistant_text_part(), startIndex: 1 },
    ];

    expect(split_settled_run(groups).folded).toEqual([]);
  });

  it('still folds ordinary tool work once the run has answered', () => {
    const groups = [
      { type: 'internal' as const, parts: project_completed_step(), startIndex: 0 },
      { type: 'part' as const, part: assistant_text_part(), startIndex: 1 },
    ];

    expect(split_settled_run(groups).folded).toHaveLength(1);
  });
});

function project_waiting_step() {
  return project_step('awaiting_approval');
}

function project_completed_step() {
  return project_step('completed');
}

const compound_call_id =
  'call_000000000000000000000001|fc_00000000000000000000000000000000000000000000000002';

function project_real_session(): ProjectedChatMessagePart[] {
  const ledger_row = {
    tool_call_id: 'tcall_01000000000000000000000004',
    run_id: 'run_1',
    tool_name: 'math-calculate-1',
    tool_status: 'awaiting_approval',
    input_data: { expression: '21 * 2', decimal_places: 40 },
    tool_call_metadata: {
      runtime_tool_call_id: compound_call_id,
      approval_request_id: 'ejob_01000000000000000000000003',
    },
  } as unknown as ToolCall;
  const engine_view = {
    tool_call_id: `stream:${compound_call_id}`,
    run_id: 'run_1',
    tool_name: 'math-calculate-1',
    tool_status: 'completed',
    input_data: { expression: '21 * 2', decimal_places: 40 },
    tool_call_metadata: { source: 'chat_event', runtime_tool_call_id: compound_call_id },
  } as unknown as ChatToolCall;

  const messages = create_projected_chat_messages({
    messages: [
      {
        ...tool_result_message(),
        tool_call_id: 'tcall_01000000000000000000000004',
      } as unknown as RunMessage,
    ],
    tool_calls: merge_chat_tool_calls([ledger_row], [engine_view]),
    catalog_nodes: [gmail_catalog_node()],
  });
  return messages.flatMap((message) => message.parts);
}

function project_step(tool_status: string): ProjectedChatMessagePart[] {
  const messages = create_projected_chat_messages({
    messages: [tool_result_message()],
    tool_calls: merge_chat_tool_calls([waiting_tool_call(tool_status)], [] as ChatToolCall[]),
    catalog_nodes: [gmail_catalog_node()],
  });
  return messages.flatMap((message) => message.parts);
}

function assistant_text_part(): ProjectedChatMessagePart {
  return { type: 'text', text: 'Ready when you are.' };
}

function waiting_tool_call(tool_status: string): ToolCall {
  return {
    tool_call_id: 'tcall_1',
    run_id: 'run_1',
    tool_name: 'gmail-send_email-1',
    tool_status,
    input_data: { to: 'anna@acme.com', subject: 'Refund for order 4471', schema_id: 'sch_1' },
  } as unknown as ToolCall;
}

function tool_result_message(): RunMessage {
  return {
    created_time: '2026-08-25T12:00:00.000Z',
    is_model_visible: true,
    is_user_visible: true,
    last_updated_time: '2026-08-25T12:00:00.000Z',
    message_content: { type: 'tool_result', text: 'Held.' },
    message_kind: 'output',
    message_role: 'tool_result',
    message_sequence: 1,
    run_id: 'run_1',
    run_message_id: 'msg_1',
    session_id: 'ses_1',
    source_metadata: { tool_name: 'gmail-send_email-1' },
    source_type: 'tool',
    tool_call_id: 'tcall_1',
  } as unknown as RunMessage;
}

function gmail_catalog_node(): CatalogNode {
  return {
    node_key: 'gmail-send_email-1',
    node_display_name: 'Send email',
    input_schema: {
      properties: {
        to: { title: 'To', type: 'string' },
        subject: { title: 'Subject', type: 'string' },
      },
    },
  } as unknown as CatalogNode;
}
