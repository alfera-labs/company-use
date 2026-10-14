import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { close_database, get_database } from '@coworker/core';
import {
  find_latest_slack_eval_prompt_run,
  get_slack_eval_dispatch_target,
} from '@coworker/core/db/queries/slack_evals';
import { run_tasks_with_concurrency } from '@coworker/evals/bounded_task_runner';
import type { EvalSuiteResult, EvalTask } from '@coworker/evals/eval_types';
import { create_slack_eval_sender, type SlackEvalSender } from '@coworker/evals/slack_eval_sender';
import {
  grade_slack_observed_suite,
  type SlackObservedSuiteOptions,
  select_observed_tasks,
} from '@coworker/evals/slack_observed_runner';
import { load_eval_tasks } from '@coworker/evals/task_source';
import { create_serial_operation_queue } from '@coworker/jobs';
import { sleep } from '@coworker/shared';

const terminal_run_statuses = new Set(['completed', 'failed', 'cancelled']);
const default_task_timeout_ms = 30 * 60 * 1000;
const default_poll_interval_ms = 5_000;
const default_task_concurrency = 5;

export type SlackLiveProgress = {
  task_id: string;
  stage: 'existing' | 'waiting' | 'sent' | 'completed' | 'timeout';
  run_id?: string;
};

export type SlackLiveSuiteOptions = SlackObservedSuiteOptions & {
  channel_id: string;
  rerun?: boolean;
  concurrency?: number;
  task_timeout_ms?: number;
  poll_interval_ms?: number;
  browser_command?: string;
  sender?: SlackEvalSender;
  on_progress?: (progress: SlackLiveProgress) => void;
};

export async function run_slack_live_suite(
  suite_name: string,
  options: SlackLiveSuiteOptions,
): Promise<EvalSuiteResult> {
  const db = get_database();
  try {
    return await run_slack_live_suite_with_database(db, suite_name, options);
  } finally {
    await close_database();
  }
}

export async function run_slack_live_suite_with_database(
  db: Database,
  suite_name: string,
  options: SlackLiveSuiteOptions,
) {
  const since = options.since ?? new Date();
  await dispatch_slack_live_suite_with_database(db, suite_name, { ...options, since });
  return grade_slack_observed_suite(db, suite_name, { ...observed_options(options), since });
}

export async function dispatch_slack_live_suite_with_database(
  db: Database,
  suite_name: string,
  options: SlackLiveSuiteOptions,
) {
  validate_live_options(options);
  const since = options.since ?? new Date();
  const target = await get_slack_eval_dispatch_target(db, options);
  const browser_command = options.browser_command ?? env.SLACK_EVAL_BROWSER_COMMAND;
  const sender =
    options.sender ??
    create_slack_eval_sender({
      team_id: target.team_id,
      channel_id: options.channel_id,
      ...(browser_command ? { browser_command } : {}),
    });
  if (!sender.post_message_if_user) {
    await validate_sender_identity(sender, target.installer_user_id);
  }

  const tasks = select_observed_tasks(await load_eval_tasks(suite_name), options);
  const post_message_exclusively = create_serial_operation_queue();
  await run_tasks_with_concurrency(
    tasks,
    options.concurrency ?? default_task_concurrency,
    async (task) =>
      dispatch_slack_task(
        db,
        (input) =>
          post_message_exclusively(() =>
            post_message_for_installer(sender, input, target.installer_user_id),
          ),
        task,
        target,
        { ...options, since },
      ),
  );
}

async function post_message_for_installer(
  sender: SlackEvalSender,
  input: { text: string },
  installer_user_id: string,
) {
  if (sender.post_message_if_user) {
    return sender.post_message_if_user({ ...input, expected_user_id: installer_user_id });
  }
  await validate_sender_identity(sender, installer_user_id);
  return sender.post_message(input);
}

async function validate_sender_identity(sender: SlackEvalSender, installer_user_id: string) {
  const sender_user_id = await sender.get_user_id();
  if (sender_user_id !== installer_user_id) {
    throw new Error(
      `Slack browser session belongs to ${sender_user_id}, expected installer ${installer_user_id}.`,
    );
  }
}

async function dispatch_slack_task(
  db: Database,
  post_message: SlackEvalSender['post_message'],
  task: EvalTask,
  target: Awaited<ReturnType<typeof get_slack_eval_dispatch_target>>,
  options: SlackLiveSuiteOptions & { since: Date },
) {
  const existing = options.rerun
    ? null
    : await find_latest_slack_eval_prompt_run(
        db,
        prompt_run_input(target, task, options.since, options.actor_email, options.channel_id),
      );
  if (existing && terminal_run_statuses.has(existing.run_status)) {
    report_progress(options, { task_id: task.task_id, stage: 'existing', run_id: existing.run_id });
    return;
  }

  const wait_since = existing ? options.since : new Date();
  if (existing) {
    report_progress(options, { task_id: task.task_id, stage: 'waiting', run_id: existing.run_id });
  } else {
    await post_message({ text: task.prompt });
    report_progress(options, { task_id: task.task_id, stage: 'sent' });
  }

  const run = await wait_for_terminal_run(db, target, task, wait_since, options);
  report_progress(options, {
    task_id: task.task_id,
    stage: run ? 'completed' : 'timeout',
    ...(run ? { run_id: run.run_id } : {}),
  });
}

async function wait_for_terminal_run(
  db: Database,
  target: { workspace_id: string },
  task: EvalTask,
  since: Date,
  options: SlackLiveSuiteOptions,
) {
  const timeout_ms = options.task_timeout_ms ?? default_task_timeout_ms;
  const deadline = Date.now() + timeout_ms;
  do {
    const run = await find_latest_slack_eval_prompt_run(
      db,
      prompt_run_input(target, task, since, options.actor_email, options.channel_id),
    );
    if (run && terminal_run_statuses.has(run.run_status)) return run;
    const wait_ms = Math.min(
      options.poll_interval_ms ?? default_poll_interval_ms,
      deadline - Date.now(),
    );
    if (wait_ms > 0) await sleep(wait_ms);
  } while (Date.now() < deadline);
  return null;
}

function prompt_run_input(
  target: { workspace_id: string },
  task: EvalTask,
  since: Date,
  actor_email?: string,
  channel_id?: string,
) {
  return {
    workspace_id: target.workspace_id,
    prompt: task.prompt,
    since,
    ...(actor_email ? { actor_email } : {}),
    ...(channel_id ? { channel_id } : {}),
  };
}

function observed_options(options: SlackLiveSuiteOptions): SlackObservedSuiteOptions {
  return {
    ...(options.workspace_id ? { workspace_id: options.workspace_id } : {}),
    ...(options.workspace_name ? { workspace_name: options.workspace_name } : {}),
    ...(options.actor_email ? { actor_email: options.actor_email } : {}),
    channel_id: options.channel_id,
    ...(options.since ? { since: options.since } : {}),
    ...(options.task_id ? { task_id: options.task_id } : {}),
    ...(options.run_id ? { run_id: options.run_id } : {}),
    ...(options.judge_provider ? { judge_provider: options.judge_provider } : {}),
    ...(options.judge_model ? { judge_model: options.judge_model } : {}),
    ...(options.skip_judge ? { skip_judge: true } : {}),
    ...(options.rejudge ? { rejudge: true } : {}),
    ...(options.judge_gateway ? { judge_gateway: options.judge_gateway } : {}),
  };
}

function validate_live_options(options: SlackLiveSuiteOptions) {
  if (!options.actor_email) throw new Error('run-slack requires --actor-email.');
  if (!/^[CGD][A-Z0-9]+$/.test(options.channel_id)) {
    throw new Error('--channel-id must be a Slack channel ID.');
  }
  if ((options.task_timeout_ms ?? 1) < 1) throw new Error('Task timeout must be positive.');
  if (!Number.isInteger(options.concurrency ?? 1) || (options.concurrency ?? 1) < 1) {
    throw new Error('Concurrency must be a positive integer.');
  }
}

function report_progress(options: SlackLiveSuiteOptions, progress: SlackLiveProgress) {
  options.on_progress?.(progress);
}
