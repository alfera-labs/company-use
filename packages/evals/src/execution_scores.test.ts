import type { EvalJudgeResult } from '@coworker/evals/eval_types';
import {
  calculate_execution_scores,
  calculate_speed_score,
  has_current_execution_score_shape,
} from '@coworker/evals/execution_scores';
import type { ObservedRunTrace } from '@coworker/evals/observed_run_trace';
import { describe, expect, it } from 'vitest';

describe('execution scores', () => {
  it('scores outcome, speed, failed calls, and missed calls independently', () => {
    const trace = trace_fixture();
    const judge = judge_fixture();

    const result = calculate_execution_scores(trace, judge);

    expect(result).toMatchObject({
      schema_version: 2,
      result_score: 80,
      speed_score: 90,
      completed_tool_call_count: 2,
      failed_tool_call_count: 1,
      tool_score: 57,
      execution_score: 78,
    });
    expect(result.execution_issues.map((issue) => issue.issue_type)).toEqual([
      'failed_tool_call',
      'missed_tool_call',
    ]);
    expect(has_current_execution_score_shape(result)).toBe(true);
  });

  it('rejects reports from older score schemas', () => {
    const scores = calculate_execution_scores(trace_fixture(), judge_fixture());

    expect(has_current_execution_score_shape({ ...scores, schema_version: 0 })).toBe(false);
  });

  it('uses stable latency anchors', () => {
    expect(calculate_speed_score(30_000)).toBe(100);
    expect(calculate_speed_score(120_000)).toBe(90);
    expect(calculate_speed_score(600_000)).toBe(30);
    expect(calculate_speed_score(1_800_001)).toBe(0);
  });

  it('annotates blocked, unfinished, and slow execution at the exact boundary', () => {
    const trace = trace_fixture();
    trace.run.duration_ms = 300_001;
    trace.tool_calls = [
      tool_call('runtime/request_approval', 'blocked'),
      tool_call('runtime/execute_tool', 'running'),
    ];
    const judge = { ...judge_fixture(), missed_tool_calls: [] };

    const result = calculate_execution_scores(trace, judge);

    expect(result).toMatchObject({
      completed_tool_call_count: 0,
      blocked_tool_call_count: 1,
      unfinished_tool_call_count: 1,
      tool_score: 0,
    });
    expect(result.execution_issues.map((issue) => issue.issue_type)).toEqual([
      'blocked_tool_call',
      'unfinished_tool_call',
      'slow_execution',
    ]);

    trace.run.duration_ms = 300_000;
    expect(
      calculate_execution_scores(trace, judge).execution_issues.map((issue) => issue.issue_type),
    ).not.toContain('slow_execution');
  });

  it('scores a trace with no tool calls without inventing tool success', () => {
    const trace = trace_fixture();
    trace.tool_calls = [];

    expect(calculate_execution_scores(trace, judge_fixture())).toMatchObject({
      completed_tool_call_count: 0,
      failed_tool_call_count: 0,
      blocked_tool_call_count: 0,
      unfinished_tool_call_count: 0,
      tool_score: 0,
    });
  });

  it('counts timed-out and cancelled calls as terminal failures', () => {
    const trace = trace_fixture();
    trace.tool_calls = [
      tool_call('runtime/search', 'timed_out'),
      tool_call('runtime/write', 'cancelled'),
      tool_call('runtime/read', 'pending'),
    ];
    const result = calculate_execution_scores(trace, {
      ...judge_fixture(),
      missed_tool_calls: [],
    });

    expect(result).toMatchObject({
      failed_tool_call_count: 2,
      unfinished_tool_call_count: 1,
      tool_score: 0,
    });
    expect(result.execution_issues.map((issue) => issue.issue_type)).toEqual([
      'failed_tool_call',
      'failed_tool_call',
      'unfinished_tool_call',
    ]);
  });
});

function judge_fixture(): EvalJudgeResult {
  return {
    passed: true,
    score: 80,
    summary: 'Mostly complete.',
    criteria: [],
    critical_failures: [],
    missing_evidence: [],
    missed_tool_calls: [
      { capability: 'google_drive/search', reason: 'The task required Drive.', evidence: ['run'] },
    ],
  };
}

function trace_fixture(): ObservedRunTrace {
  const created_time = new Date();
  return {
    run: {
      run_id: 'run_test',
      workspace_id: 'ws_test',
      session_id: 'ses_test',
      run_status: 'completed',
      model_provider: 'anthropic',
      model_name: 'claude-sonnet-5',
      error_code: null,
      error_message: null,
      duration_ms: 120_000,
      input_tokens: 10,
      output_tokens: 20,
      cache_read_tokens: 0,
      cost_microcents: 5,
      run_metadata: {},
      created_time,
    },
    messages: [],
    tool_calls: [
      tool_call('runtime/list_connections', 'completed'),
      tool_call('runtime/execute_tool', 'failed'),
      tool_call('slack/respond', 'completed'),
    ],
    files: [],
  };
}

function tool_call(tool_name: string, tool_status: string) {
  return {
    tool_name,
    tool_status,
    risk_class: null,
    approval_mode: null,
    input_data: {},
    output_text: null,
    output_data: null,
    error_code: tool_status === 'failed' ? 'provider_action_failed' : null,
    error_message: null,
    duration_ms: 1,
    created_time: new Date(),
  };
}
