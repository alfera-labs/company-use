import type { EvalExecutionIssue, EvalTaskResult } from '@coworker/evals/eval_types';
import { format_error_message } from '@coworker/shared';

export function failed_task_result(
  task_id: string,
  failure_reason: string,
  issue_type: 'timeout' | 'dispatch_error' | 'grading_error',
  error: unknown,
  duration_ms = 0,
): EvalTaskResult {
  return {
    task_id,
    attempt_index: 1,
    status: 'error',
    failure_reason,
    duration_ms,
    end_to_end_duration_ms: duration_ms,
    internal_run_duration_ms: 0,
    run_id: 'missing',
    eval_report_id: 'missing',
    tool_call_count: 0,
    result_score: 0,
    speed_score: 0,
    tool_score: 0,
    execution_score: 0,
    completed_tool_call_count: 0,
    failed_tool_call_count: 0,
    missed_tool_calls: [],
    execution_issues: [task_operation_issue(issue_type, error)],
    cost_microcents: 0,
  };
}

export function task_timeout_issue(
  timeout_ms = 30 * 60 * 1000,
): EvalExecutionIssue & { issue_type: 'timeout' } {
  return {
    issue_type: 'timeout',
    message: `Slack run did not finish within ${Math.round(timeout_ms / 1000)} seconds.`,
    evidence: ['eval_harness'],
  };
}

export function task_operation_issue<
  TIssueType extends 'timeout' | 'dispatch_error' | 'grading_error',
>(issue_type: TIssueType, error: unknown): EvalExecutionIssue & { issue_type: TIssueType } {
  const message = format_error_message(error);
  return {
    issue_type,
    message: message.slice(0, 500),
    evidence: ['eval_harness'],
  };
}
