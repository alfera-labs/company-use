import type { EvalExecutionScoresData } from '@coworker/core/db/schema/json_column_types';
import type { EvalExecutionIssue, EvalJudgeResult } from '@coworker/evals/eval_types';
import type { ObservedRunTrace } from '@coworker/evals/observed_run_trace';

const execution_score_schema_version = 2;
const failed_tool_statuses = new Set(['failed', 'timed_out', 'cancelled']);

export function calculate_execution_scores(
  trace: ObservedRunTrace,
  judge: EvalJudgeResult | undefined,
) {
  const result_score = judge?.score ?? 0;
  const internal_run_duration_ms = trace.run.duration_ms ?? 0;
  const end_to_end_duration_ms = trace.run.end_to_end_duration_ms ?? internal_run_duration_ms;
  const speed_score = calculate_speed_score(end_to_end_duration_ms);
  const tool_counts = count_tool_outcomes(trace);
  const missed_tool_calls = judge?.missed_tool_calls ?? [];
  const tool_score = calculate_tool_score(tool_counts, missed_tool_calls.length);
  const execution_score = Math.round(result_score * 0.7 + speed_score * 0.15 + tool_score * 0.15);

  return {
    schema_version: execution_score_schema_version,
    result_score,
    speed_score,
    tool_score,
    execution_score,
    end_to_end_duration_ms,
    internal_run_duration_ms,
    ...tool_counts,
    missed_tool_calls,
    execution_issues: build_execution_issues(trace, missed_tool_calls),
  };
}

export function has_current_execution_score_shape(value: EvalExecutionScoresData | undefined) {
  return value?.schema_version === execution_score_schema_version;
}

export function calculate_speed_score(duration_ms: number) {
  const points = [
    [60_000, 100],
    [120_000, 90],
    [180_000, 80],
    [300_000, 60],
    [600_000, 30],
    [1_800_000, 0],
  ] as const;
  if (duration_ms <= points[0][0]) return points[0][1];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current || duration_ms > current[0]) continue;
    const progress = (duration_ms - previous[0]) / (current[0] - previous[0]);
    return Math.round(previous[1] + progress * (current[1] - previous[1]));
  }
  return 0;
}

function count_tool_outcomes(trace: ObservedRunTrace) {
  const completed_tool_call_count = trace.tool_calls.filter(
    (tool_call) => tool_call.tool_status === 'completed',
  ).length;
  const failed_tool_call_count = trace.tool_calls.filter((tool_call) =>
    failed_tool_statuses.has(tool_call.tool_status),
  ).length;
  const blocked_tool_call_count = trace.tool_calls.filter(
    (tool_call) => tool_call.tool_status === 'blocked',
  ).length;
  const unfinished_tool_call_count =
    trace.tool_calls.length -
    completed_tool_call_count -
    failed_tool_call_count -
    blocked_tool_call_count;
  return {
    completed_tool_call_count,
    failed_tool_call_count,
    blocked_tool_call_count,
    unfinished_tool_call_count,
  };
}

function calculate_tool_score(
  counts: ReturnType<typeof count_tool_outcomes>,
  missed_tool_call_count: number,
) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const reliability_score = total === 0 ? 0 : (counts.completed_tool_call_count / total) * 100;
  return Math.max(0, Math.round(reliability_score - missed_tool_call_count * 10));
}

function build_execution_issues(
  trace: ObservedRunTrace,
  missed_tool_calls: EvalJudgeResult['missed_tool_calls'],
): EvalExecutionIssue[] {
  const issues = trace.tool_calls.flatMap((tool_call, index) => {
    if (tool_call.tool_status === 'completed') return [];
    const issue_type = tool_issue_type(tool_call.tool_status);
    return [
      {
        issue_type,
        message: `${tool_call.tool_name}: ${tool_call.error_code ?? tool_call.tool_status}`,
        evidence: [`tool_${index + 1}`],
      } satisfies EvalExecutionIssue,
    ];
  });
  issues.push(
    ...missed_tool_calls.map((missed) => ({
      issue_type: 'missed_tool_call' as const,
      message: `${missed.capability}: ${missed.reason}`,
      evidence: missed.evidence,
    })),
  );
  const end_to_end_duration_ms = trace.run.end_to_end_duration_ms ?? trace.run.duration_ms ?? 0;
  if (end_to_end_duration_ms > 300_000) {
    issues.push({
      issue_type: 'slow_execution',
      message: `End-to-end execution took ${Math.round(end_to_end_duration_ms / 1000)} seconds.`,
      evidence: ['run'],
    });
  }
  return issues;
}

function tool_issue_type(status: string): EvalExecutionIssue['issue_type'] {
  if (failed_tool_statuses.has(status)) return 'failed_tool_call';
  if (status === 'blocked') return 'blocked_tool_call';
  return 'unfinished_tool_call';
}
