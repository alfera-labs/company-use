import { load_browser_skill_prompt } from '@agent-core/browser/browser_tool';
import {
  type BrowserBarResult,
  check_browser_eval_bar,
  format_value,
} from '@coworker/evals/browser/browser_eval_bar';
import { run_browser_eval_suite } from '@coworker/evals/browser/browser_eval_runner';
import type { BrowserEvalReport } from '@coworker/evals/browser/browser_eval_types';
import { open_browser_sandbox_session } from '@coworker/evals/browser/browser_sandbox_session';
import { load_browser_eval_tasks } from '@coworker/evals/browser/browser_task_source';
import { resolve_browser_model } from '@runtime-platform/tools/browser_harness';

async function main() {
  const suite_name = process.argv[2];
  const tasks = await load_browser_eval_tasks(suite_name);
  if (tasks.length === 0) {
    throw new Error(`No browser eval tasks found${suite_name ? ` for suite ${suite_name}` : ''}`);
  }

  const report = await run_browser_eval_suite(tasks, {
    open_session: open_browser_sandbox_session,
    load_system_prompt: load_browser_skill_prompt,
    model: resolve_browser_model(),
  });

  print_report(report);
  const bar = check_browser_eval_bar(report);
  print_bar(bar.results);

  if (!bar.passed) {
    console.error('BROWSER_EVAL_BELOW_BAR');
    process.exit(1);
  }
  console.log('BROWSER_EVAL_OK');
}

function print_report(report: BrowserEvalReport) {
  for (const breakdown of report.suite_breakdowns) {
    console.log(
      `suite ${breakdown.suite}: ${format_value(breakdown.pass_rate, 'rate')} over ${breakdown.task_count} tasks`,
    );
  }
  console.log(
    `median action round-trip ${format_value(report.median_action_round_trip_ms, 'ms')}, ` +
      `median tokens/task ${format_value(report.median_tokens_per_task, 'count')}, ` +
      `create→first snapshot ${format_value(report.median_create_to_first_snapshot_ms, 'ms')}`,
  );
}

function print_bar(results: BrowserBarResult[]) {
  for (const result of results) {
    console.log(
      `[${result.passed ? 'PASS' : 'FAIL'}] ${result.name}: ${format_value(result.value, value_format(result.name))} (need ${result.threshold})`,
    );
  }
}

function value_format(name: string): 'rate' | 'ms' | 'count' {
  if (name.includes('rate')) return 'rate';
  if (name.includes('round-trip') || name.includes('snapshot')) return 'ms';
  return 'count';
}

main().catch((error) => {
  console.error('BROWSER_EVAL_FAILED', error);
  process.exit(1);
});
