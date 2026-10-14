import { automation_lifecycle } from '@api/services/automations/automation_lifecycle';
import { env } from '@coworker/config';
import {
  parse_date,
  parse_positive_integer,
  parse_positive_number,
} from '@coworker/evals/cli_option_values';
import { run_eval_suite } from '@coworker/evals/runner';
import {
  run_slack_isolated_suite,
  type SlackIsolatedSuiteOptions,
} from '@coworker/evals/slack_isolated_runner';
import {
  run_slack_live_suite,
  type SlackLiveProgress,
  type SlackLiveSuiteOptions,
} from '@coworker/evals/slack_live_runner';
import {
  run_slack_observed_suite,
  type SlackObservedSuiteOptions,
} from '@coworker/evals/slack_observed_runner';
import { configure_automation_lifecycle } from '@runtime-platform/automations/automation_lifecycle';

type SlackRunSuiteOptions = SlackLiveSuiteOptions | SlackIsolatedSuiteOptions;
type SlackOptionDraft = SlackObservedSuiteOptions &
  Partial<SlackLiveSuiteOptions> &
  Partial<SlackIsolatedSuiteOptions>;

configure_automation_lifecycle(automation_lifecycle);

async function main() {
  const [command, suite_name, ...raw_options] = process.argv.slice(2);
  if (!command || !suite_name || !['run', 'grade-slack', 'run-slack'].includes(command)) {
    print_usage();
    process.exitCode = 1;
    return;
  }

  const result = await run_command(command, suite_name, raw_options);
  print_result(result);
}

async function run_command(command: string, suite_name: string, raw_options: string[]) {
  if (command === 'run') return run_eval_suite(suite_name, parse_run_options(raw_options));
  if (command === 'grade-slack') {
    return run_slack_observed_suite(suite_name, parse_slack_options(raw_options, false));
  }
  const options = parse_slack_options(raw_options, true);
  if ('fixture_manifest_path' in options) {
    return run_slack_isolated_suite(suite_name, {
      ...options,
      on_progress: print_slack_progress,
    });
  }
  return run_slack_live_suite(suite_name, {
    ...options,
    on_progress: print_slack_progress,
  });
}

function print_slack_progress(progress: SlackLiveProgress) {
  const detail = progress.run_id ?? '';
  console.log(`${progress.stage.padEnd(9)} ${progress.task_id} ${detail}`.trimEnd());
}

function print_result(result: Awaited<ReturnType<typeof run_eval_suite>>) {
  const passed_count = result.task_results.filter((task) => task.status === 'pass').length;
  const total_count = result.task_results.length;

  for (const task of result.task_results) {
    const reason = task.failure_reason ? ` ${task.failure_reason}` : '';
    const score = task.judge_score === undefined ? '' : ` judge=${task.judge_score}`;
    const execution =
      task.execution_score === undefined
        ? ''
        : ` execution=${task.execution_score} speed=${task.speed_score} tools=${task.tool_score}`;
    console.log(
      `${task.status.padEnd(7)} ${task.task_id}#${task.attempt_index} run=${task.run_id}${score}${execution}${reason}`,
    );
  }

  console.log('');
  console.log(`suite ${result.suite_name}: ${passed_count}/${total_count} passed`);
  console.log(`pass_rate ${result.pass_rate.toFixed(4)}`);
  console.log(`average_execution_score ${result.average_execution_score}`);
  console.log(`p50_duration_ms ${result.p50_duration_ms}`);
  console.log(`p95_duration_ms ${result.p95_duration_ms}`);
  console.log(`median_tool_call_count ${result.median_tool_call_count}`);
  console.log(`tool_success_rate ${result.tool_success_rate.toFixed(4)}`);
  console.log(`missed_tool_call_count ${result.missed_tool_call_count}`);
  console.log(`failed_tool_call_count ${result.failed_tool_call_count}`);
  console.log(`total_cost_microcents ${result.total_cost_microcents}`);
  console.log(`top_failure_reasons ${JSON.stringify(result.top_failure_reasons)}`);

  if (passed_count < total_count) process.exitCode = 1;
}

function parse_run_options(raw_options: string[]) {
  const options: { attempts?: number; task_id?: string } = {};
  for (let index = 0; index < raw_options.length; index += 1) {
    const option = raw_options[index];
    const value = raw_options[index + 1];
    if (option === '--attempts') {
      if (!value) throw new Error('--attempts requires a value');
      options.attempts = Number(value);
      index += 1;
      continue;
    }
    if (option === '--task') {
      if (!value) throw new Error('--task requires a value');
      options.task_id = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${option}`);
  }
  if (
    options.attempts !== undefined &&
    (!Number.isInteger(options.attempts) || options.attempts < 1)
  ) {
    throw new Error('--attempts must be a positive integer');
  }
  return options;
}

function parse_slack_options(raw_options: string[], live: false): SlackObservedSuiteOptions;
function parse_slack_options(raw_options: string[], live: true): SlackRunSuiteOptions;
function parse_slack_options(
  raw_options: string[],
  live: boolean,
): SlackObservedSuiteOptions | SlackRunSuiteOptions {
  const options = default_slack_options();
  for (let index = 0; index < raw_options.length; index += 1) {
    const option = raw_options[index];
    if (option === '--no-judge') {
      options.skip_judge = true;
      continue;
    }
    if (option === '--rejudge') {
      options.rejudge = true;
      continue;
    }
    if (option === '--rerun') {
      if (!live) throw new Error('--rerun is only supported by run-slack');
      options.rerun = true;
      continue;
    }
    if (option === '--headless') {
      if (!live) throw new Error('--headless is only supported by run-slack');
      options.browser_headless = true;
      continue;
    }
    const value = raw_options[index + 1];
    if (!value) throw new Error(`${option} requires a value`);
    if (option === '--workspace-id') options.workspace_id = value;
    else if (option === '--fixture-manifest') {
      if (!live) throw new Error('--fixture-manifest is only supported by run-slack');
      options.fixture_manifest_path = value;
    } else if (option === '--workspace-name') options.workspace_name = value;
    else if (option === '--actor-email') options.actor_email = value;
    else if (option === '--task') options.task_id = value;
    else if (option === '--run') options.run_id = value;
    else if (option === '--judge-provider') options.judge_provider = value;
    else if (option === '--judge-model') options.judge_model = value;
    else if (option === '--since') options.since = parse_date(value, '--since');
    else if (option === '--channel-id') {
      options.channel_id = value;
    } else if (option === '--task-timeout-minutes') {
      if (!live) throw new Error('--task-timeout-minutes is only supported by run-slack');
      options.task_timeout_ms = parse_positive_number(value, option) * 60 * 1000;
    } else if (option === '--concurrency') {
      if (!live) throw new Error('--concurrency is only supported by run-slack');
      options.concurrency = parse_positive_integer(value, option);
    } else if (option === '--browser-profile') {
      if (!live) throw new Error('--browser-profile is only supported by run-slack');
      options.browser_profile_path = value;
    } else if (option === '--browser-executable') {
      if (!live) throw new Error('--browser-executable is only supported by run-slack');
      options.browser_executable_path = value;
    } else throw new Error(`Unknown option: ${option}`);
    index += 1;
  }
  validate_slack_options(options, live);
  if (!live) return options as SlackObservedSuiteOptions;
  if (options.fixture_manifest_path) return options as SlackIsolatedSuiteOptions;
  return options as SlackLiveSuiteOptions;
}

function default_slack_options(): SlackOptionDraft {
  return {
    ...(env.SLACK_EVAL_WORKSPACE_NAME ? { workspace_name: env.SLACK_EVAL_WORKSPACE_NAME } : {}),
    ...(env.SLACK_EVAL_ACTOR_EMAIL ? { actor_email: env.SLACK_EVAL_ACTOR_EMAIL } : {}),
    ...(env.SLACK_EVAL_CHANNEL_ID ? { channel_id: env.SLACK_EVAL_CHANNEL_ID } : {}),
  };
}

function validate_slack_options(options: SlackOptionDraft, live: boolean) {
  const fixture_manifest_path = live ? options.fixture_manifest_path : undefined;
  if (!fixture_manifest_path && !options.workspace_id && !options.workspace_name) {
    throw new Error(
      `${live ? 'run-slack' : 'grade-slack'} requires --workspace-id or --workspace-name`,
    );
  }
  if (options.skip_judge && options.rejudge) {
    throw new Error('--rejudge cannot be combined with --no-judge');
  }
  if (options.channel_id && !/^[CGD][A-Z0-9]+$/.test(options.channel_id)) {
    throw new Error('--channel-id must be a Slack channel ID');
  }
  if (live && !fixture_manifest_path && !options.channel_id) {
    throw new Error('run-slack requires --channel-id or --fixture-manifest');
  }
  if (
    live &&
    !fixture_manifest_path &&
    (options.browser_profile_path || options.browser_executable_path || options.browser_headless)
  ) {
    throw new Error('parallel browser options require --fixture-manifest');
  }
  if (live && options.run_id) throw new Error('--run is only supported by grade-slack');
}

function print_usage() {
  console.error('Usage: bun run evals run <suite> [--attempts N] [--task TASK_ID]');
  console.error(
    '       bun run evals grade-slack <suite> (--workspace-id ID | --workspace-name NAME) [--channel-id ID] [--actor-email EMAIL] [--since ISO] [--task TASK_ID --run RUN_ID] [--judge-provider PROVIDER] [--judge-model MODEL] [--rejudge] [--no-judge]',
  );
  console.error(
    '       bun run evals run-slack <suite> ((--workspace-id ID | --workspace-name NAME) --channel-id ID --actor-email EMAIL | --fixture-manifest PATH) [--since ISO] [--task TASK_ID] [--rerun] [--concurrency N] [--task-timeout-minutes N] [--browser-profile PATH] [--browser-executable PATH] [--headless]',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
