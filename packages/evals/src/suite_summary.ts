import type { EvalSuiteResult, EvalTaskResult } from '@coworker/evals/eval_types';

export function summarize_eval_suite(
  suite_name: string,
  task_results: EvalTaskResult[],
): EvalSuiteResult {
  const failure_counts = count_failures(task_results);
  const task_count = task_results.length;
  const execution_scores = task_results.map((result) => result.execution_score ?? 0);
  const total_tool_calls = task_results.reduce(
    (total, result) => total + result.tool_call_count,
    0,
  );
  const completed_tool_calls = task_results.reduce(
    (total, result) => total + (result.completed_tool_call_count ?? 0),
    0,
  );
  return {
    suite_name,
    pass_rate:
      task_count === 0
        ? 0
        : task_results.filter((result) => result.status === 'pass').length / task_count,
    average_execution_score: average(execution_scores),
    p50_duration_ms: percentile(sorted_values(task_results, 'duration_ms'), 0.5),
    p95_duration_ms: percentile(sorted_values(task_results, 'duration_ms'), 0.95),
    median_tool_call_count: percentile(sorted_values(task_results, 'tool_call_count'), 0.5),
    tool_success_rate: total_tool_calls === 0 ? 0 : completed_tool_calls / total_tool_calls,
    missed_tool_call_count: task_results.reduce(
      (total, result) => total + (result.missed_tool_calls?.length ?? 0),
      0,
    ),
    failed_tool_call_count: task_results.reduce(
      (total, result) => total + (result.failed_tool_call_count ?? 0),
      0,
    ),
    total_cost_microcents: task_results.reduce(
      (total, result) => total + (result.cost_microcents ?? 0),
      0,
    ),
    top_failure_reasons: [...failure_counts.entries()]
      .map(([failure_reason, count]) => ({ failure_reason, count }))
      .sort((a, b) => b.count - a.count),
    task_results,
  };
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function sorted_values(task_results: EvalTaskResult[], field: 'duration_ms' | 'tool_call_count') {
  return task_results
    .filter((result) => result.status !== 'missing')
    .map((result) => result[field])
    .sort((a, b) => a - b);
}

function count_failures(task_results: EvalTaskResult[]) {
  const failure_counts = new Map<string, number>();
  for (const result of task_results) {
    if (!result.failure_reason) continue;
    failure_counts.set(result.failure_reason, (failure_counts.get(result.failure_reason) ?? 0) + 1);
  }
  return failure_counts;
}

function percentile(sorted_numbers: number[], percentile_value: number) {
  if (sorted_numbers.length === 0) return 0;
  return sorted_numbers[Math.floor((sorted_numbers.length - 1) * percentile_value)] ?? 0;
}
