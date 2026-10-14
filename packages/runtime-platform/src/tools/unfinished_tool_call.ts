import type { Database, tool_calls } from '@coworker/core';
import type { ToolPolicyApprovalGrantData } from '@coworker/core/db/schema/json_column_types';
import {
  create_logger,
  type RuntimeToolResult as PlatformRuntimeToolResult,
} from '@coworker/shared';
import {
  ask_whether_to_run_again,
  type RepeatApprovalContext,
} from '@runtime-platform/tools/policies/repeat_approval';
import { restore_tool_call_outputs } from '@runtime-platform/tools/stored_tool_result_reads';
import { is_tool_result_v2 } from '@runtime-platform/tools/stored_tool_result_shape';
import {
  find_existing_effect_by_tool,
  find_tool_repeat_safety,
  type UnfinishedToolCall,
} from '@runtime-platform/tools/tool_repeat_safety';

const log = create_logger('unfinished_tool_call');

type ToolCallRow = typeof tool_calls.$inferSelect;

export type RepeatDecision =
  | { action: 'run'; grant?: ToolPolicyApprovalGrantData }
  | { action: 'answer'; result: PlatformRuntimeToolResult }
  | { action: 'wait' }
  | { action: 'reuse_saved_result'; saved: SavedToolResult };

export type SavedToolResult = { output: unknown; result_is_stored: boolean };

function has_a_saved_result(row: ToolCallRow) {
  return row.tool_status !== 'awaiting_approval' && row.output_data !== null;
}

export function tool_call_has_finished(row: ToolCallRow) {
  return !['pending', 'executing'].includes(row.tool_status);
}

export function is_unfinished_tool_call(row: ToolCallRow) {
  return (
    ['pending', 'executing'].includes(row.tool_status) &&
    row.output_data === null &&
    row.output_text === null
  );
}

export async function decide_how_to_repeat(
  db: Database,
  context: RepeatApprovalContext,
  row: ToolCallRow,
  model_tool_call_id: string | undefined,
): Promise<RepeatDecision> {
  if (has_a_saved_result(row)) {
    return { action: 'reuse_saved_result', saved: await read_saved_result(db, row) };
  }
  if (!is_unfinished_tool_call(row)) return { action: 'run' };

  const call: UnfinishedToolCall = {
    tool_call_id: row.tool_call_id,
    tool_name: row.tool_name,
    tool_call_metadata: row.tool_call_metadata,
    started_time: row.started_time ?? row.created_time,
  };
  const safety = find_tool_repeat_safety(call);
  log.info('a tool call started before a restart and has no result', {
    workspace_id: row.workspace_id,
    run_id: row.run_id,
    tool_call_id: row.tool_call_id,
    tool_name: row.tool_name,
    repeat_safety: safety,
  });
  if (safety === 'safe_to_repeat') return { action: 'run' };
  if (safety === 'check_before_repeat') {
    const checked = await check_for_the_effect(call);
    if (checked) return checked;
  }
  return ask_the_person(db, context, row, model_tool_call_id);
}

async function read_saved_result(db: Database, row: ToolCallRow): Promise<SavedToolResult> {
  const restored = await restore_tool_call_outputs(db, {
    workspace_id: row.workspace_id,
    rows: [row],
    reading: 'load_full_value',
  });
  return {
    output: restored[0]?.output_data,
    result_is_stored: is_tool_result_v2(row.output_data),
  };
}

async function check_for_the_effect(call: UnfinishedToolCall): Promise<RepeatDecision | null> {
  const find_existing_effect = find_existing_effect_by_tool[call.tool_name];
  if (!find_existing_effect) return null;
  const effect = await find_existing_effect(call);
  if (effect.status === 'not_found') return { action: 'run' };
  if (effect.status === 'unknown') {
    log.warn('could not check whether the effect already happened', {
      tool_call_id: call.tool_call_id,
      tool_name: call.tool_name,
      reason: effect.reason,
    });
    return null;
  }
  return {
    action: 'answer',
    result: {
      success: true,
      data: { already_done: true, summary: effect.summary, ...effect.details },
    },
  };
}

async function ask_the_person(
  db: Database,
  context: RepeatApprovalContext,
  row: ToolCallRow,
  model_tool_call_id: string | undefined,
): Promise<RepeatDecision> {
  const answer = await ask_whether_to_run_again(db, context, {
    tool_call_id: row.tool_call_id,
    tool_name: row.tool_name,
    input_data: row.input_data,
    ...(model_tool_call_id ? { model_tool_call_id } : {}),
  });
  if (answer.answer === 'approved') return { action: 'run', grant: answer.grant };
  if (answer.answer === 'unanswered') return { action: 'wait' };
  return {
    action: 'answer',
    result: { success: false, error: { code: 'repeat_declined', message: answer.reason } },
  };
}

export function still_waiting_for_a_person_result(): PlatformRuntimeToolResult {
  return {
    success: true,
    data: {
      awaiting_approval: true,
      message:
        'This step is still waiting for a person and it did not run again. Stop here. It continues on its own once somebody answers.',
    },
  };
}
