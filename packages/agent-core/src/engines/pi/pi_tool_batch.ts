import type {
  DecideRuntimeToolBatch,
  RuntimeToolBatchAnswer,
  RuntimeToolBatchCall,
} from '@agent-core/tools/runtime_tool';
import type { AgentToolCall } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';

export type UnrunAnswer = Extract<RuntimeToolBatchAnswer, { message: string }>;

export type PiToolBatchDecider = {
  settle_batch_once(assistant_message: AssistantMessage, signal?: AbortSignal): Promise<void>;
  find_answer(tool_call_id: string): UnrunAnswer | undefined;
};

// pi asks `beforeToolCall` for every call in a turn, in order, before it starts any of them —
// and hands each one the whole assistant message. That is what makes one decision per turn both
// possible and race-free: by the time any tool executes, the answer covering it is already known.
// Deciding inside `execute` instead would let a fast call finish before a slow decision on its
// neighbour landed.
export function create_pi_tool_batch_decider(
  decide_tool_batch: DecideRuntimeToolBatch,
): PiToolBatchDecider {
  const settled_batches = new Map<string, Promise<void>>();
  const answer_by_tool_call_id = new Map<string, UnrunAnswer>();

  async function settle(calls: RuntimeToolBatchCall[], signal?: AbortSignal) {
    const decision = await decide_tool_batch(calls);
    if (decision.kind !== 'needs_approval') return;

    const answer = await decision.wait_for_answer(signal);
    if (answer.answer === 'approved') return;
    for (const call of calls) answer_by_tool_call_id.set(call.tool_call_id, answer);
  }

  return {
    settle_batch_once(assistant_message, signal) {
      const calls = read_tool_batch_calls(assistant_message);
      if (calls.length === 0) return Promise.resolve();

      const batch_key = tool_batch_key(calls);
      const settled = settled_batches.get(batch_key);
      if (settled) return settled;

      const pending = settle(calls, signal);
      settled_batches.set(batch_key, pending);
      return pending;
    },
    find_answer(tool_call_id) {
      return answer_by_tool_call_id.get(tool_call_id);
    },
  };
}

function read_tool_batch_calls(assistant_message: AssistantMessage): RuntimeToolBatchCall[] {
  return assistant_message.content
    .filter((part): part is AgentToolCall => part.type === 'toolCall')
    .map((part) => ({
      tool_call_id: part.id,
      tool_name: part.name,
      input: part.arguments,
    }));
}

function tool_batch_key(calls: RuntimeToolBatchCall[]) {
  return calls
    .map((call) => call.tool_call_id)
    .sort()
    .join('|');
}
