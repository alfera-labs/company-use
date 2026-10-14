import type {
  RuntimeAgentMessage,
  RuntimeToolCallMessagePart,
} from '@agent-core/messages/runtime_message';

// Providers (Anthropic strictly, others loosely) require a well-formed message sequence:
// every tool result directly follows the tool call it answers, every tool call is answered,
// and no message is empty. Context windowing, visibility filtering, or a run that crashed
// mid-tool can break these invariants — and a broken sequence makes the provider hard-reject
// the whole request. This module is the provider-agnostic gate that guarantees the invariant
// on our canonical `RuntimeAgentMessage[]` before it reaches any provider.
//
// `make_messages_well_formed` repairs (used in production so one bad turn never crashes a run).
// `assert_messages_well_formed` throws (used in tests/CI so the bug surfaces loudly).

function read_tool_result_id(message: RuntimeAgentMessage): string | undefined {
  if (message.tool_call_id) return message.tool_call_id;
  const part = message.content.find((candidate) => candidate.type === 'tool_result');
  return part?.type === 'tool_result' ? part.tool_call_id : undefined;
}

function read_tool_call_parts(message: RuntimeAgentMessage): RuntimeToolCallMessagePart[] {
  return message.content.filter(
    (part): part is RuntimeToolCallMessagePart => part.type === 'tool_call',
  );
}

function create_interrupted_tool_result_message(
  tool_call_id: string,
  tool_name: string,
): RuntimeAgentMessage {
  return {
    role: 'tool',
    tool_call_id,
    name: tool_name,
    content: [
      {
        type: 'tool_result',
        tool_call_id,
        tool_name,
        result: {
          ok: false,
          error_code: 'tool_call_interrupted',
          error_message:
            'This tool call did not complete (the run was interrupted). No result is available.',
        },
      },
    ],
  };
}

type IndexedToolResult = { message: RuntimeAgentMessage; index: number };

function queue_tool_results_by_call_id(messages: readonly RuntimeAgentMessage[]) {
  const results_by_call_id = new Map<string, IndexedToolResult[]>();
  messages.forEach((message, index) => {
    if (message.role !== 'tool' || message.content.length === 0) return;
    const id = read_tool_result_id(message);
    if (id === undefined) return;
    const queue = results_by_call_id.get(id) ?? [];
    queue.push({ message, index });
    results_by_call_id.set(id, queue);
  });
  return results_by_call_id;
}

function take_tool_results_for_calls(
  calls: readonly RuntimeToolCallMessagePart[],
  call_index: number,
  results_by_call_id: Map<string, IndexedToolResult[]>,
): RuntimeAgentMessage[] {
  const found: IndexedToolResult[] = [];
  const missing: RuntimeToolCallMessagePart[] = [];
  for (const call of calls) {
    const queue = results_by_call_id.get(call.id) ?? [];
    while (queue.length > 0 && (queue[0]?.index ?? 0) < call_index) queue.shift();
    const result = queue.shift();
    if (result) found.push(result);
    else missing.push(call);
  }
  return [
    ...found.sort((a, b) => a.index - b.index).map((result) => result.message),
    ...missing.map((call) => create_interrupted_tool_result_message(call.id, call.name)),
  ];
}

export function make_messages_well_formed(
  messages: readonly RuntimeAgentMessage[],
): RuntimeAgentMessage[] {
  const results_by_call_id = queue_tool_results_by_call_id(messages);
  const well_formed: RuntimeAgentMessage[] = [];

  messages.forEach((message, index) => {
    if (message.content.length === 0 || message.role === 'tool') return;
    well_formed.push(message);
    if (message.role !== 'assistant') return;
    const calls = read_tool_call_parts(message);
    well_formed.push(...take_tool_results_for_calls(calls, index, results_by_call_id));
  });

  return well_formed;
}

export function assert_messages_well_formed(messages: readonly RuntimeAgentMessage[]): void {
  let unanswered_tool_call_ids = new Set<string>();

  for (const message of messages) {
    if (message.content.length === 0) {
      throw new Error(`message-integrity: empty content on a ${message.role} message`);
    }

    if (message.role === 'tool') {
      const id = read_tool_result_id(message);
      if (id === undefined || !unanswered_tool_call_ids.has(id)) {
        throw new Error(
          `message-integrity: tool_result does not follow its tool_use: ${id ?? 'unknown'}`,
        );
      }
      unanswered_tool_call_ids.delete(id);
      continue;
    }

    if (unanswered_tool_call_ids.size > 0) {
      throw new Error(
        `message-integrity: tool_call not answered before the next message: ${[...unanswered_tool_call_ids].join(', ')}`,
      );
    }
    if (message.role === 'assistant') {
      unanswered_tool_call_ids = new Set(read_tool_call_parts(message).map((call) => call.id));
    }
  }

  if (unanswered_tool_call_ids.size > 0) {
    throw new Error(
      `message-integrity: dangling tool_call with no tool_result: ${[...unanswered_tool_call_ids].join(', ')}`,
    );
  }
}
