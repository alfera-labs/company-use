import type { Database } from '@coworker/core';
import { close_database, get_database } from '@coworker/core';
import { get_slack_eval_dispatch_target } from '@coworker/core/db/queries/slack_evals';
import { map_with_concurrency } from '@coworker/evals/bounded_map';
import type {
  EvalExecutionIssue,
  EvalSuiteResult,
  EvalTaskResult,
} from '@coworker/evals/eval_types';
import { default_browser_profile_path } from '@coworker/evals/slack_eval_browser_defaults';
import { create_slack_eval_sender, type SlackEvalSender } from '@coworker/evals/slack_eval_sender';
import {
  load_slack_fixture_manifest,
  ready_fixture_by_task,
  type SlackEvalFixture,
} from '@coworker/evals/slack_fixture_manifest';
import {
  dispatch_slack_live_suite_with_database,
  type SlackLiveSuiteOptions,
} from '@coworker/evals/slack_live_runner';
import {
  grade_slack_observed_suite,
  type SlackObservedSuiteOptions,
  select_observed_tasks,
} from '@coworker/evals/slack_observed_runner';
import { open_slack_parallel_playwright_context } from '@coworker/evals/slack_parallel_playwright_context';
import { create_slack_parallel_playwright_sender } from '@coworker/evals/slack_parallel_playwright_sender';
import {
  failed_task_result,
  task_operation_issue,
  task_timeout_issue,
} from '@coworker/evals/slack_task_issues';
import { summarize_eval_suite } from '@coworker/evals/suite_summary';
import { load_eval_tasks } from '@coworker/evals/task_source';
import { create_serial_operation_queue } from '@coworker/jobs';

const default_isolated_concurrency = 15;

type ManagedSlackEvalSender = {
  sender: SlackEvalSender;
  close(): Promise<void>;
};

type SlackEvalSenderPool = {
  create_sender(fixture: SlackEvalFixture): Promise<ManagedSlackEvalSender>;
  close(): Promise<void>;
};

type SlackDispatchIssue = {
  issue: EvalExecutionIssue & { issue_type: 'timeout' | 'dispatch_error' };
  duration_ms: number;
};

type PerFixtureLiveOptions = Omit<
  SlackLiveSuiteOptions,
  | 'workspace_id'
  | 'workspace_name'
  | 'actor_email'
  | 'channel_id'
  | 'sender'
  | 'task_id'
  | 'concurrency'
>;

export type SlackIsolatedSuiteOptions = Omit<
  SlackLiveSuiteOptions,
  'workspace_id' | 'workspace_name' | 'actor_email' | 'channel_id' | 'sender'
> & {
  fixture_manifest_path: string;
  sender_factory?: (fixture: SlackEvalFixture) => Promise<SlackEvalSender>;
  browser_profile_path?: string;
  browser_executable_path?: string;
  browser_headless?: boolean;
};

export async function run_slack_isolated_suite(
  suite_name: string,
  options: SlackIsolatedSuiteOptions,
): Promise<EvalSuiteResult> {
  const db = get_database();
  try {
    return await run_slack_isolated_suite_with_database(db, suite_name, options);
  } finally {
    await close_database();
  }
}

export async function run_slack_isolated_suite_with_database(
  db: Database,
  suite_name: string,
  options: SlackIsolatedSuiteOptions,
) {
  const manifest = await load_slack_fixture_manifest(options.fixture_manifest_path);
  if (manifest.suite_name !== suite_name) {
    throw new Error(`Fixture manifest belongs to ${manifest.suite_name}, not ${suite_name}.`);
  }
  const tasks = select_observed_tasks(await load_eval_tasks(suite_name), options);
  const fixtures = ready_fixture_by_task(
    manifest,
    tasks.map((task) => task.task_id),
  );
  const since = options.since ?? new Date();
  const sender_pool = await open_sender_pool(db, options);
  const dispatch_results = await dispatch_isolated_tasks(
    db,
    suite_name,
    tasks,
    fixtures,
    options,
    since,
    sender_pool,
  );
  const dispatch_issues = new Map(
    tasks.flatMap((task, index) => {
      const issue = dispatch_results[index];
      return issue ? [[task.task_id, issue] as const] : [];
    }),
  );
  const task_results = await map_with_concurrency(
    tasks,
    options.concurrency ?? default_isolated_concurrency,
    async (task) => {
      try {
        const fixture = fixtures.get(task.task_id);
        if (!fixture) throw new Error(`${task.task_id} fixture is missing.`);
        const result = await grade_slack_observed_suite(
          db,
          suite_name,
          fixture_grade_options(options, fixture, task.task_id, since),
        );
        const task_result = result.task_results[0];
        if (!task_result) throw new Error(`${task.task_id} did not return an eval result.`);
        return add_dispatch_issue(task_result, dispatch_issues.get(task.task_id));
      } catch (error) {
        const result = failed_task_result(
          task.task_id,
          'eval_grading_failed',
          'grading_error',
          error,
        );
        const dispatch_issue = dispatch_issues.get(task.task_id);
        return dispatch_issue
          ? {
              ...result,
              execution_issues: [dispatch_issue.issue, ...(result.execution_issues ?? [])],
            }
          : result;
      }
    },
  );
  return summarize_eval_suite(suite_name, task_results);
}

async function dispatch_isolated_tasks(
  db: Database,
  suite_name: string,
  tasks: Awaited<ReturnType<typeof load_eval_tasks>>,
  fixtures: Map<string, SlackEvalFixture>,
  options: SlackIsolatedSuiteOptions,
  since: Date,
  sender_pool: SlackEvalSenderPool,
) {
  try {
    return await map_with_concurrency(
      tasks,
      options.concurrency ?? default_isolated_concurrency,
      async (task) => {
        let managed_sender: ManagedSlackEvalSender | undefined;
        const dispatch_started_time = Date.now();
        let dispatch_issue: SlackDispatchIssue | null = null;
        let timed_out = false;
        try {
          const fixture = fixtures.get(task.task_id);
          if (!fixture) throw new Error(`${task.task_id} fixture is missing.`);
          managed_sender = await sender_pool.create_sender(fixture);
          await dispatch_slack_live_suite_with_database(db, suite_name, {
            ...shared_live_options(options),
            workspace_id: fixture.product_workspace_id as string,
            actor_email: fixture.slack_actor_email,
            channel_id: fixture.slack_channel_id as string,
            task_id: task.task_id,
            since,
            sender: managed_sender.sender,
            on_progress: (progress) => {
              if (progress.stage === 'timeout') timed_out = true;
              options.on_progress?.(progress);
            },
          });
          if (timed_out) {
            dispatch_issue = {
              issue: task_timeout_issue(options.task_timeout_ms),
              duration_ms: Math.max(1, Date.now() - dispatch_started_time),
            };
          }
        } catch (error) {
          dispatch_issue = {
            issue: task_operation_issue('dispatch_error', error),
            duration_ms: Math.max(1, Date.now() - dispatch_started_time),
          };
        }
        try {
          await managed_sender?.close();
        } catch (error) {
          dispatch_issue ??= {
            issue: task_operation_issue('dispatch_error', error),
            duration_ms: Math.max(1, Date.now() - dispatch_started_time),
          };
        }
        return dispatch_issue;
      },
    );
  } finally {
    await sender_pool.close();
  }
}

function add_dispatch_issue(
  result: EvalTaskResult,
  dispatch_issue: SlackDispatchIssue | undefined,
): EvalTaskResult {
  if (!dispatch_issue) return result;
  const { issue, duration_ms } = dispatch_issue;
  if (result.status === 'missing') {
    return failed_task_result(
      result.task_id,
      issue.issue_type === 'timeout' ? 'slack_run_timeout' : 'slack_dispatch_failed',
      issue.issue_type,
      issue.message,
      duration_ms,
    );
  }
  return {
    ...result,
    execution_issues: [...(result.execution_issues ?? []), issue],
  };
}

async function open_sender_pool(
  db: Database,
  options: SlackIsolatedSuiteOptions,
): Promise<SlackEvalSenderPool> {
  const sender_factory = options.sender_factory;
  if (sender_factory) {
    return {
      create_sender: async (fixture) => ({
        sender: await sender_factory(fixture),
        close: async () => undefined,
      }),
      close: async () => undefined,
    };
  }
  if (options.browser_command) return open_serial_browser_sender_pool(db, options.browser_command);

  const context = await open_slack_parallel_playwright_context({
    user_data_directory: options.browser_profile_path ?? default_browser_profile_path,
    ...(options.browser_executable_path
      ? { executable_path: options.browser_executable_path }
      : {}),
    ...(options.browser_headless === undefined ? {} : { headless: options.browser_headless }),
  });
  return {
    create_sender: async (fixture) => {
      const target = await fixture_dispatch_target(db, fixture);
      const page = await context.newPage();
      return {
        sender: create_slack_parallel_playwright_sender({
          page,
          team_id: target.team_id,
          channel_id: fixture.slack_channel_id as string,
        }),
        close: () => page.close(),
      };
    },
    close: () => context.close(),
  };
}

function open_serial_browser_sender_pool(
  db: Database,
  browser_command: string,
): SlackEvalSenderPool {
  const run_browser_command_exclusively = create_serial_operation_queue();
  return {
    create_sender: async (fixture) => ({
      sender: serialize_sender(
        await create_fixture_sender(db, fixture, browser_command),
        run_browser_command_exclusively,
      ),
      close: async () => undefined,
    }),
    close: async () => undefined,
  };
}

async function fixture_dispatch_target(db: Database, fixture: SlackEvalFixture) {
  if (!fixture.product_workspace_id) {
    throw new Error(`${fixture.task_id} fixture is missing a product workspace.`);
  }
  const target = await get_slack_eval_dispatch_target(db, {
    workspace_id: fixture.product_workspace_id,
  });
  if (target.team_id !== fixture.slack_team_id) {
    throw new Error(`${fixture.task_id} Slack team does not match its active connection.`);
  }
  return target;
}

async function create_fixture_sender(
  db: Database,
  fixture: SlackEvalFixture,
  browser_command?: string,
) {
  const target = await fixture_dispatch_target(db, fixture);
  return create_slack_eval_sender({
    team_id: target.team_id,
    channel_id: fixture.slack_channel_id as string,
    activate_channel_for_each_operation: true,
    ...(browser_command ? { browser_command } : {}),
  });
}

function serialize_sender(
  sender: SlackEvalSender,
  run_exclusively: ReturnType<typeof create_serial_operation_queue>,
): SlackEvalSender {
  const post_message_if_user = sender.post_message_if_user;
  return {
    get_user_id: () => run_exclusively(() => sender.get_user_id()),
    post_message: (input) => run_exclusively(() => sender.post_message(input)),
    ...(post_message_if_user
      ? {
          post_message_if_user: (input) =>
            run_exclusively(() => post_message_if_user.call(sender, input)),
        }
      : {}),
  };
}

function shared_live_options(options: SlackIsolatedSuiteOptions): PerFixtureLiveOptions {
  const {
    fixture_manifest_path: _fixture_manifest_path,
    sender_factory: _sender_factory,
    browser_profile_path: _browser_profile_path,
    browser_executable_path: _browser_executable_path,
    browser_headless: _browser_headless,
    concurrency: _concurrency,
    task_id: _task_id,
    ...shared
  } = options;
  return shared;
}

function fixture_grade_options(
  options: SlackIsolatedSuiteOptions,
  fixture: SlackEvalFixture,
  task_id: string,
  since: Date,
): SlackObservedSuiteOptions {
  if (!fixture.product_workspace_id || !fixture.slack_channel_id) {
    throw new Error(`${task_id} fixture is missing grading identifiers.`);
  }
  return {
    workspace_id: fixture.product_workspace_id,
    actor_email: fixture.slack_actor_email,
    channel_id: fixture.slack_channel_id,
    task_id,
    since,
    ...(options.judge_provider ? { judge_provider: options.judge_provider } : {}),
    ...(options.judge_model ? { judge_model: options.judge_model } : {}),
    ...(options.skip_judge ? { skip_judge: true } : {}),
    ...(options.rejudge ? { rejudge: true } : {}),
    ...(options.judge_gateway ? { judge_gateway: options.judge_gateway } : {}),
  };
}
