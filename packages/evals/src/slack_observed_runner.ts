import type { LlmGateway } from '@agent-core/llm_gateway';
import { close_database, type Database, get_database } from '@coworker/core';
import {
  create_eval_report,
  list_eval_reports,
  update_eval_report,
} from '@coworker/core/db/queries/evals';
import {
  list_slack_eval_run_candidates,
  type SlackEvalRunCandidate,
} from '@coworker/core/db/queries/slack_evals';
import type { EvalReportMetadataData } from '@coworker/core/db/schema/json_column_types';
import { map_with_concurrency } from '@coworker/evals/bounded_map';
import { calculate_task_rubric_fingerprint } from '@coworker/evals/eval_definition_fingerprint';
import type {
  EvalSuiteResult,
  EvalTask,
  EvalTaskResult,
  GraderResult,
} from '@coworker/evals/eval_types';
import {
  calculate_execution_scores,
  has_current_execution_score_shape,
} from '@coworker/evals/execution_scores';
import { current_git_version } from '@coworker/evals/git_version';
import { run_llm_judge } from '@coworker/evals/llm_judge';
import { build_observed_run_trace } from '@coworker/evals/observed_run_trace';
import { grade_observed_slack_trace } from '@coworker/evals/slack_observed_graders';
import { summarize_eval_suite } from '@coworker/evals/suite_summary';
import { load_eval_tasks } from '@coworker/evals/task_source';
import { format_error_message } from '@coworker/shared';

const eval_actor_id = 'system:slack_evals';
type PersistedEvalReport = Awaited<ReturnType<typeof list_eval_reports>>[number];

export type SlackObservedSuiteOptions = {
  workspace_id?: string;
  workspace_name?: string;
  actor_email?: string;
  channel_id?: string;
  since?: Date;
  task_id?: string;
  run_id?: string;
  judge_provider?: string;
  judge_model?: string;
  skip_judge?: boolean;
  rejudge?: boolean;
  judge_gateway?: LlmGateway;
};

export async function run_slack_observed_suite(
  suite_name: string,
  options: SlackObservedSuiteOptions,
): Promise<EvalSuiteResult> {
  const db = get_database();
  try {
    return await grade_slack_observed_suite(db, suite_name, options);
  } finally {
    await close_database();
  }
}

export async function grade_slack_observed_suite(
  db: Database,
  suite_name: string,
  options: SlackObservedSuiteOptions,
) {
  const tasks = select_observed_tasks(await load_eval_tasks(suite_name), options);
  const candidates = await list_slack_eval_run_candidates(db, {
    prompts: tasks.map((task) => task.prompt),
    ...(options.workspace_id ? { workspace_id: options.workspace_id } : {}),
    ...(options.workspace_name ? { workspace_name: options.workspace_name } : {}),
    ...(options.actor_email ? { actor_email: options.actor_email } : {}),
    ...(options.channel_id ? { channel_id: options.channel_id } : {}),
    since: options.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  });
  const reports = await list_eval_reports(db, { suite_name });
  const selected_runs = select_task_runs(tasks, candidates, options.run_id);
  const harness_version = await current_git_version();
  const task_results = await map_with_concurrency(tasks, 4, async (task) => {
    const candidate = selected_runs.get(task.task_id);
    if (!candidate) return missing_task_result(task.task_id);
    const existing_report = reports.find(
      (report) => report.task_id === task.task_id && report.run_id === candidate.run_id,
    );
    if (existing_report && can_reuse_eval_report(existing_report, task, options)) {
      return task_result_from_report(existing_report);
    }
    return grade_slack_task(
      db,
      suite_name,
      task,
      candidate,
      harness_version,
      options,
      existing_report,
    );
  });
  return summarize_eval_suite(suite_name, task_results);
}

async function grade_slack_task(
  db: Database,
  suite_name: string,
  task: EvalTask,
  candidate: SlackEvalRunCandidate,
  harness_version: string,
  options: SlackObservedSuiteOptions,
  existing_report?: PersistedEvalReport,
): Promise<EvalTaskResult> {
  const trace = await build_observed_run_trace(db, candidate);
  const grader_results = grade_observed_slack_trace(trace, task.graders);
  const failed_grader = grader_results.find((result) => !result.passed);
  let judge: Awaited<ReturnType<typeof run_llm_judge>> | undefined;
  let judge_error: string | undefined;

  if (!options.skip_judge && task.judge) {
    try {
      judge = await run_llm_judge(task, trace, grader_results, {
        ...(options.judge_gateway ? { gateway: options.judge_gateway } : {}),
        ...(options.judge_provider ? { model_proxy: options.judge_provider } : {}),
        ...(options.judge_model ? { model_name: options.judge_model } : {}),
      });
    } catch (error) {
      judge_error = format_error_message(error);
    }
  }

  const outcome = eval_outcome(failed_grader, judge?.judgment.passed, judge_error);
  const execution_scores = calculate_execution_scores(trace, judge?.judgment);
  const judge_cost = judge?.usage?.cost_microcents ?? 0;
  const report_input = {
    suite_name,
    task_source: 'slack',
    task_id: task.task_id,
    run_id: trace.run.run_id,
    harness_version,
    runtime_version: harness_version,
    model_id: `${trace.run.model_provider ?? 'unknown'}/${trace.run.model_name ?? 'unknown'}`,
    status: outcome.status,
    failure_reason: outcome.failure_reason,
    duration_ms: execution_scores.end_to_end_duration_ms,
    input_tokens: trace.run.input_tokens,
    output_tokens: trace.run.output_tokens,
    cache_read_tokens: trace.run.cache_read_tokens,
    cost_microcents: trace.run.cost_microcents + judge_cost,
    tool_call_count: trace.tool_calls.length,
    trace_pointer: `run:${trace.run.run_id}`,
    metadata: {
      source: 'slack_observed',
      prompt: task.prompt,
      task_rubric_fingerprint: calculate_task_rubric_fingerprint(task),
      actor_email: options.actor_email,
      deterministic_grader_results: grader_results,
      execution_scores,
      ...(judge
        ? { judge: judge.judgment, judge_model_id: judge.model_id, judge_usage: judge.usage }
        : {}),
      ...(judge_error ? { judge_error } : {}),
    },
    actor_id: eval_actor_id,
  } as const;
  const eval_report = existing_report
    ? await update_eval_report(db, {
        ...report_input,
        eval_report_id: existing_report.eval_report_id,
      })
    : await create_eval_report(db, report_input);

  return {
    task_id: task.task_id,
    attempt_index: 1,
    status: outcome.status,
    failure_reason: outcome.failure_reason,
    duration_ms: execution_scores.end_to_end_duration_ms,
    run_id: trace.run.run_id,
    eval_report_id: eval_report.eval_report_id,
    tool_call_count: trace.tool_calls.length,
    ...(judge ? { judge_score: judge.judgment.score } : {}),
    ...execution_scores,
    cost_microcents: trace.run.cost_microcents + judge_cost,
  };
}

export function select_observed_tasks(tasks: EvalTask[], options: SlackObservedSuiteOptions) {
  const observed = tasks.filter((task) => task.runner.runner_type === 'slack_observed');
  const selected = options.task_id
    ? observed.filter((task) => task.task_id === options.task_id)
    : observed;
  if (selected.length === 0) throw new Error('No matching slack_observed eval tasks found.');
  if (options.run_id && selected.length !== 1)
    throw new Error('--run requires exactly one --task.');
  return selected;
}

function select_task_runs(
  tasks: EvalTask[],
  candidates: SlackEvalRunCandidate[],
  required_run_id?: string,
) {
  return new Map(
    tasks.flatMap((task) => {
      const candidate = candidates.find(
        (item) =>
          item.prompt_text === task.prompt && (!required_run_id || item.run_id === required_run_id),
      );
      return candidate ? [[task.task_id, candidate] as const] : [];
    }),
  );
}

function task_result_from_report(report: PersistedEvalReport): EvalTaskResult {
  const judge_score = report.metadata.judge?.score;
  return {
    task_id: report.task_id,
    attempt_index: 1,
    status: persisted_eval_status(report.status),
    failure_reason: report.failure_reason,
    duration_ms: report.duration_ms,
    run_id: report.run_id,
    eval_report_id: report.eval_report_id,
    tool_call_count: report.tool_call_count,
    ...(judge_score === undefined ? {} : { judge_score }),
    ...read_execution_score_fields(report.metadata),
    cost_microcents: report.cost_microcents,
  };
}

function read_execution_score_fields(metadata: EvalReportMetadataData) {
  const scores = metadata.execution_scores;
  if (!scores) return {};
  return {
    result_score: scores.result_score,
    speed_score: scores.speed_score,
    tool_score: scores.tool_score,
    execution_score: scores.execution_score,
    end_to_end_duration_ms: scores.end_to_end_duration_ms,
    internal_run_duration_ms: scores.internal_run_duration_ms,
    completed_tool_call_count: scores.completed_tool_call_count,
    failed_tool_call_count: scores.failed_tool_call_count,
    missed_tool_calls: scores.missed_tool_calls,
    execution_issues: scores.execution_issues,
  };
}

function can_reuse_eval_report(
  report: PersistedEvalReport,
  task: EvalTask,
  options: SlackObservedSuiteOptions,
) {
  if (options.rejudge) return false;
  const metadata = report.metadata;
  if (metadata.task_rubric_fingerprint !== calculate_task_rubric_fingerprint(task)) return false;
  if (!has_current_execution_score_shape(metadata.execution_scores)) return false;
  const judge = metadata.judge;
  if (options.skip_judge) return report.status !== 'error' && judge === undefined;
  if (report.status === 'error') return false;
  if (!task.judge) return true;
  return judge?.score !== undefined;
}

function persisted_eval_status(status: string): EvalTaskResult['status'] {
  if (status === 'pass' || status === 'fail' || status === 'error') return status;
  throw new Error(`Unknown persisted eval status: ${status}`);
}

function eval_outcome(
  failed_grader: GraderResult | undefined,
  judge_passed: boolean | undefined,
  judge_error: string | undefined,
): { status: 'pass' | 'fail' | 'error'; failure_reason: string | null } {
  if (judge_error) return { status: 'error', failure_reason: 'upstream_error' };
  if (failed_grader) return { status: 'fail', failure_reason: failed_grader.failure_reason };
  if (judge_passed === false) return { status: 'fail', failure_reason: 'llm_judge_failed' };
  return { status: 'pass', failure_reason: null };
}

function missing_task_result(task_id: string): EvalTaskResult {
  return {
    task_id,
    attempt_index: 1,
    status: 'missing',
    failure_reason: 'slack_run_missing',
    duration_ms: 0,
    run_id: 'missing',
    eval_report_id: 'missing',
    tool_call_count: 0,
  };
}
