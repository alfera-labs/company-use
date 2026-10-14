import type { SessionEnv } from '@agent-core/environment/session_env';
import type { RuntimeToolCallMessagePart } from '@agent-core/messages/runtime_message';
import type {
  DecideRuntimeToolBatch,
  RuntimeToolBatchCall,
  RuntimeToolDefinition,
} from '@agent-core/tools';
import type { Database } from '@coworker/core';
import {
  get_run,
  list_run_messages,
  list_run_tool_calls,
} from '@coworker/core/db/queries/sessions';
import { AppError, create_logger, type MessageContent } from '@coworker/shared';
import type { RunAudience } from '@runtime-platform/orchestrator/run_audience';
import { message_content_to_runtime_parts } from '@runtime-platform/orchestrator/runtime_message_content';

const log = create_logger('run_resume');

const run_statuses_that_can_continue = new Set(['queued', 'starting', 'running']);

export async function read_run_to_resume(
  db: Database,
  input: { workspace_id: string; session_id: string; run_id: string },
) {
  const run = await get_run(db, input.workspace_id, input.run_id);
  if (!run || run.session_id !== input.session_id) {
    throw new AppError('run_not_resumable', `Run ${input.run_id} is not in this session.`, 409);
  }
  if (!run_statuses_that_can_continue.has(run.run_status)) {
    throw new AppError(
      'run_not_resumable',
      `Run ${input.run_id} already ended as ${run.run_status}.`,
      409,
    );
  }
  return run;
}

export function run_can_continue(run: { run_status: string }) {
  return run_statuses_that_can_continue.has(run.run_status);
}

export async function find_interrupted_tool_calls(
  db: Database,
  input: { workspace_id: string; run_id: string },
) {
  const [messages, ledger] = await Promise.all([
    list_run_messages(db, input.workspace_id, input.run_id),
    list_run_tool_calls(db, input.workspace_id, input.run_id),
  ]);
  const last_turn = messages
    .filter((message) => message.message_role === 'assistant' && message.is_model_visible)
    .at(-1);
  if (!last_turn) return { calls: [], started: false };

  const ledger_by_key = new Map(ledger.map((row) => [row.idempotency_key, row]));
  const answered_rows = new Set(
    messages.flatMap((message) =>
      message.message_role === 'tool_result' && message.tool_call_id ? [message.tool_call_id] : [],
    ),
  );
  const turn_calls = message_content_to_runtime_parts(
    last_turn.message_content as MessageContent,
  ).filter((part): part is RuntimeToolCallMessagePart => part.type === 'tool_call');
  const rows = turn_calls.map((call) => ledger_by_key.get(`${input.run_id}:${call.id}`));
  const calls = turn_calls.filter((_call, index) => {
    const row = rows[index];
    return !row || !answered_rows.has(row.tool_call_id);
  });
  return { calls, started: rows.some((row) => row !== undefined) };
}

export async function finish_interrupted_tool_turn(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    tools: readonly RuntimeToolDefinition[];
    decide_tool_batch: DecideRuntimeToolBatch;
    environment: SessionEnv;
    signal?: AbortSignal | undefined;
    run_audience: RunAudience;
  },
) {
  const interrupted = await find_interrupted_tool_calls(db, input);
  if (interrupted.calls.length === 0) return 0;

  const batch: RuntimeToolBatchCall[] = interrupted.calls.map((call) => ({
    tool_call_id: call.id,
    tool_name: call.name,
    input: call.arguments,
  }));
  if (!interrupted.started && !(await the_turn_may_run(input, batch))) return 0;

  await run_interrupted_calls_in_order(input, interrupted.calls);
  return interrupted.calls.length;
}

async function the_turn_may_run(
  input: Parameters<typeof finish_interrupted_tool_turn>[1],
  batch: RuntimeToolBatchCall[],
) {
  const decision = await input.decide_tool_batch(batch);
  if (decision.kind === 'run') return true;
  const answer = await decision.wait_for_answer(input.signal);
  return answer.answer === 'approved';
}

async function run_interrupted_calls_in_order(
  input: Parameters<typeof finish_interrupted_tool_turn>[1],
  calls: readonly RuntimeToolCallMessagePart[],
): Promise<void> {
  const [call, ...rest] = calls;
  if (!call) return;
  await run_interrupted_call(input, call);
  await run_interrupted_calls_in_order(input, rest);
}

async function run_interrupted_call(
  input: Parameters<typeof finish_interrupted_tool_turn>[1],
  call: RuntimeToolCallMessagePart,
) {
  const tool = input.tools.find((candidate) => candidate.tool_name === call.name);
  if (!tool?.execute) {
    log.warn('an interrupted tool call names a tool this run does not have', {
      run_id: input.run_id,
      tool_name: call.name,
    });
    return;
  }
  await tool
    .execute(call.arguments, {
      run_key: input.run_id,
      session_key: input.session_id,
      tool_call_id: call.id,
      environment: input.environment,
      ...(input.signal ? { signal: input.signal } : {}),
      metadata: { run_audience: input.run_audience },
    })
    .catch((error: unknown) => {
      log.error('an interrupted tool call failed when it was finished', {
        run_id: input.run_id,
        tool_name: call.name,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
