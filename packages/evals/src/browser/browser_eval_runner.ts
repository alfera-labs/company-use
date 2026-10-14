import { run_browser_agent } from '@agent-core/browser/browse_agent';
import type { BrowserSession } from '@agent-core/browser/types';
import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import type { RuntimeAgentEngine } from '@agent-core/runs/agent_run';
import type {
  BrowserEvalReport,
  BrowserEvalSuite,
  BrowserEvalTask,
  BrowserSuiteBreakdown,
  BrowserTaskRun,
} from '@coworker/evals/browser/browser_eval_types';
import { grade_browser_task } from '@coworker/evals/browser/browser_graders';
import { format_error_message } from '@coworker/shared';

export type OpenedBrowserSession = {
  session: BrowserSession;
  release: () => Promise<void>;
};

export type BrowserEvalDependencies = {
  open_session: () => Promise<OpenedBrowserSession>;
  load_system_prompt: (session: BrowserSession) => Promise<string>;
  model: RuntimeModelConfig;
  engine?: RuntimeAgentEngine;
  signal?: AbortSignal;
};

export async function run_browser_eval_task(
  task: BrowserEvalTask,
  deps: BrowserEvalDependencies,
): Promise<BrowserTaskRun> {
  const created_at = Date.now();
  let opened: OpenedBrowserSession | undefined;
  try {
    opened = await deps.open_session();
    const session = opened.session;
    await session.exec(['snapshot', '-i']);
    const create_to_first_snapshot_ms = Math.max(1, Date.now() - created_at);
    const system_prompt = await deps.load_system_prompt(session);

    const result = await run_browser_agent({
      session,
      goal: task.goal,
      ...(task.start_url === undefined ? {} : { start_url: task.start_url }),
      system_prompt,
      model: deps.model,
      ...(deps.engine === undefined ? {} : { engine: deps.engine }),
      ...(task.max_steps === undefined ? {} : { max_steps: task.max_steps }),
      run_key: task.task_id,
      ...(deps.signal === undefined ? {} : { signal: deps.signal }),
    });
    const grade = await grade_browser_task(session, task.graders, result.final_text);

    return {
      task_id: task.task_id,
      suite: task.suite,
      passed: grade.passed,
      failure_reason: grade.failure_reason,
      step_count: result.step_count,
      action_samples: result.actions,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      total_tokens: result.total_tokens,
      create_to_first_snapshot_ms,
      final_text: result.final_text,
    };
  } catch (error) {
    return {
      task_id: task.task_id,
      suite: task.suite,
      passed: false,
      failure_reason: `drive_error: ${format_error_message(error)}`,
      step_count: 0,
      action_samples: [],
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      create_to_first_snapshot_ms: Math.max(1, Date.now() - created_at),
      final_text: '',
    };
  } finally {
    await opened?.release().catch(() => undefined);
  }
}

export async function run_browser_eval_suite(
  tasks: BrowserEvalTask[],
  deps: BrowserEvalDependencies,
): Promise<BrowserEvalReport> {
  const task_runs: BrowserTaskRun[] = [];
  for (const task of tasks) {
    task_runs.push(await run_browser_eval_task(task, deps));
  }
  return summarize_browser_eval(task_runs);
}

export function summarize_browser_eval(task_runs: BrowserTaskRun[]): BrowserEvalReport {
  const suite_breakdowns = (['smoke', 'realistic', 'act_then_verify'] as BrowserEvalSuite[])
    .map((suite) => suite_breakdown(task_runs, suite))
    .filter((breakdown) => breakdown.task_count > 0);
  const action_durations = task_runs.flatMap((run) =>
    run.action_samples.map((sample) => sample.duration_ms),
  );

  return {
    suite_breakdowns,
    cooperative_smoke_pass_rate: pass_rate_for_suite(task_runs, 'smoke'),
    realistic_pass_rate: pass_rate_for_suite(task_runs, 'realistic'),
    act_then_verify_catch_rate: pass_rate_for_suite(task_runs, 'act_then_verify'),
    median_action_round_trip_ms: median(action_durations),
    median_tokens_per_task: median(task_runs.map((run) => run.total_tokens)),
    median_create_to_first_snapshot_ms: median(
      task_runs.map((run) => run.create_to_first_snapshot_ms),
    ),
    task_runs,
  };
}

function suite_breakdown(
  task_runs: BrowserTaskRun[],
  suite: BrowserEvalSuite,
): BrowserSuiteBreakdown {
  const runs = task_runs.filter((run) => run.suite === suite);
  return {
    suite,
    task_count: runs.length,
    pass_rate: pass_rate(runs),
  };
}

function pass_rate_for_suite(task_runs: BrowserTaskRun[], suite: BrowserEvalSuite): number {
  return pass_rate(task_runs.filter((run) => run.suite === suite));
}

function pass_rate(runs: BrowserTaskRun[]): number {
  if (runs.length === 0) return 0;
  return runs.filter((run) => run.passed).length / runs.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.floor((sorted.length - 1) / 2);
  return sorted[index] ?? 0;
}
