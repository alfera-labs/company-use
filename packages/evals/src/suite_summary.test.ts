import type { EvalTaskResult } from '@coworker/evals/eval_types';
import { summarize_eval_suite } from '@coworker/evals/suite_summary';
import { describe, expect, it } from 'vitest';

describe('summarize_eval_suite', () => {
  it('keeps missing coverage in pass rate without corrupting execution percentiles', () => {
    const result = summarize_eval_suite('operator', [
      task_result({
        status: 'pass',
        duration_ms: 120_000,
        tool_call_count: 14,
        execution_score: 80,
      }),
      task_result({ status: 'missing', failure_reason: 'slack_run_missing' }),
    ]);

    expect(result).toMatchObject({
      pass_rate: 0.5,
      p50_duration_ms: 120_000,
      p95_duration_ms: 120_000,
      median_tool_call_count: 14,
      average_execution_score: 40,
      top_failure_reasons: [{ failure_reason: 'slack_run_missing', count: 1 }],
    });
  });

  it('returns numeric zeroes for an empty suite', () => {
    expect(summarize_eval_suite('empty', [])).toMatchObject({
      pass_rate: 0,
      average_execution_score: 0,
      p50_duration_ms: 0,
      p95_duration_ms: 0,
      median_tool_call_count: 0,
      tool_success_rate: 0,
      missed_tool_call_count: 0,
      failed_tool_call_count: 0,
      total_cost_microcents: 0,
    });
  });

  it('aggregates completed, failed, and missed tool calls across tasks', () => {
    const result = summarize_eval_suite('operator', [
      task_result({
        tool_call_count: 4,
        completed_tool_call_count: 3,
        failed_tool_call_count: 1,
        missed_tool_calls: [
          { capability: 'drive/search', reason: 'required', evidence: ['run'] },
          { capability: 'slack/post', reason: 'required', evidence: ['run'] },
        ],
      }),
      task_result({
        tool_call_count: 2,
        completed_tool_call_count: 1,
        failed_tool_call_count: 1,
      }),
      task_result({ status: 'missing', failure_reason: 'slack_run_missing' }),
    ]);

    expect(result.tool_success_rate).toBeCloseTo(4 / 6);
    expect(result.missed_tool_call_count).toBe(2);
    expect(result.failed_tool_call_count).toBe(2);
  });
});

function task_result(overrides: Partial<EvalTaskResult>): EvalTaskResult {
  return {
    task_id: 'task',
    attempt_index: 1,
    status: 'pass',
    failure_reason: null,
    duration_ms: 0,
    run_id: 'run',
    eval_report_id: 'eval',
    tool_call_count: 0,
    ...overrides,
  };
}
