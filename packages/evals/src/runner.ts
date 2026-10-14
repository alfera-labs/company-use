import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import type { RuntimeToolContext } from '@agent-core/tools/runtime_tool';
import { close_database, type Database, get_database } from '@coworker/core';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_eval_report } from '@coworker/core/db/queries/evals';
import { list_run_files } from '@coworker/core/db/queries/files';
import {
  acquire_session_execution_lock,
  create_run,
  create_run_message,
  create_session,
  get_run,
  get_session,
  list_run_events,
  list_run_model_context_snapshots,
  list_run_tool_calls,
  release_session_execution_lock,
  update_run_performance_metrics,
  update_run_status,
  update_session_context_summary,
  update_session_runtime_environment,
} from '@coworker/core/db/queries/sessions';
import type {
  CanonicalFailureReason,
  EvalActionSpec,
  EvalGraderSpec,
  EvalSuiteOptions,
  EvalSuiteResult,
  EvalTask,
  EvalTaskResult,
  EvalTaskState,
  GraderResult,
} from '@coworker/evals/eval_types';
import {
  grade_command_output_contains,
  grade_command_succeeds,
  grade_http_server_checks,
} from '@coworker/evals/generic_graders';
import { summarize_eval_suite } from '@coworker/evals/suite_summary';
import { load_eval_tasks } from '@coworker/evals/task_source';
import { run_workspace_command } from '@coworker/evals/workspace_command';
import { format_error_message, type MessageContent } from '@coworker/shared';
import { open_runtime_file } from '@runtime-platform/files/file_service';
import {
  read_context_snapshots,
  store_run_model_context_snapshot,
} from '@runtime-platform/orchestrator/context/stored_context_snapshot';
import {
  build_session_context,
  create_model_context_snapshot,
} from '@runtime-platform/orchestrator/context_builder';
import {
  cancel_agent_run,
  start_agent_run,
} from '@runtime-platform/orchestrator/runtime_orchestrator';
import {
  mark_coding_workspace_idle,
  open_or_create_coding_workspace,
} from '@runtime-platform/orchestrator/workspace_runtime';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';

const exec_file = promisify(execFile);
const repository_root = path.resolve(import.meta.dirname, '../../..');
const actor_id = 'system:evals';
type PersistedEvalStatus = Exclude<EvalTaskResult['status'], 'missing'>;

export async function run_eval_suite(
  suite_name: string,
  options: EvalSuiteOptions = {},
): Promise<EvalSuiteResult> {
  const db = get_database();
  try {
    const tasks = filter_tasks(await load_eval_tasks(suite_name), options);
    const harness_version = await current_git_version();
    const results: EvalTaskResult[] = [];
    const attempts = Math.max(1, options.attempts ?? 1);

    for (let attempt_index = 1; attempt_index <= attempts; attempt_index += 1) {
      for (const task of tasks) {
        results.push(await run_eval_task(db, suite_name, task, harness_version, attempt_index));
      }
    }

    return summarize_eval_suite(suite_name, results);
  } finally {
    await close_database();
  }
}

async function run_eval_task(
  db: Database,
  suite_name: string,
  task: EvalTask,
  harness_version: string,
  attempt_index: number,
): Promise<EvalTaskResult> {
  if (task.runner.runner_type === 'slack_observed') {
    throw new Error('slack_observed tasks must use `bun run evals grade-slack`.');
  }
  if (task.runner.runner_type === 'coworker_agent') {
    return run_agent_eval_task(db, suite_name, task, harness_version, attempt_index);
  }

  const state = await create_eval_task_state(db, task, attempt_index);
  let status: PersistedEvalStatus = 'pass';
  let failure_reason: CanonicalFailureReason | null = null;
  const failure_messages: string[] = [];

  try {
    await execute_task(state);
    await finalize_task_run_record(state);

    const grader_results = await grade_task_sequence(state);
    const failed_grader = grader_results.find((result) => !result.passed);
    if (failed_grader) {
      status = 'fail';
      failure_reason = failed_grader.failure_reason ?? 'grader_mismatch';
      failure_messages.push(...grader_results.flatMap((result) => result.message ?? []));
    }
  } catch (error) {
    status = 'error';
    failure_reason = failure_reason_from_error(error);
    failure_messages.push(format_error_message(error));
    await mark_task_failed(state, failure_messages.join('\n'));
  } finally {
    await close_task_workspace(state).catch(() => undefined);
  }

  const duration_ms = Math.max(1, Date.now() - state.started_at);
  const [run, tool_calls] = await Promise.all([
    get_run(db, state.workspace_id, state.run_id),
    list_run_tool_calls(db, state.workspace_id, state.run_id),
  ]);
  const eval_report = await create_eval_report(db, {
    suite_name,
    task_source: 'internal',
    task_id: task.task_id,
    run_id: state.run_id,
    runtime_environment_id: state.runtime_environment_id,
    harness_version,
    runtime_version: harness_version,
    model_id: `${run?.model_provider ?? 'eval'}/${run?.model_name ?? 'minimal-trust-loop'}`,
    status,
    failure_reason,
    duration_ms,
    input_tokens: run?.input_tokens ?? 0,
    output_tokens: run?.output_tokens ?? 0,
    cache_read_tokens: run?.cache_read_tokens ?? 0,
    cost_microcents: run?.cost_microcents_estimate ?? run?.cost_microcents ?? 0,
    tool_call_count: tool_calls.length,
    trace_pointer: `run:${state.run_id}`,
    actor_id,
  });

  return {
    task_id: task.task_id,
    attempt_index,
    status,
    failure_reason,
    duration_ms,
    run_id: state.run_id,
    eval_report_id: eval_report.eval_report_id,
    tool_call_count: tool_calls.length,
  };
}

async function run_agent_eval_task(
  db: Database,
  suite_name: string,
  task: EvalTask,
  harness_version: string,
  attempt_index: number,
): Promise<EvalTaskResult> {
  const runner = task.runner;
  if (runner.runner_type !== 'coworker_agent') {
    throw new Error(`Invalid agent eval runner: ${runner.runner_type}`);
  }

  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: `Eval ${task.task_id} attempt ${attempt_index}`,
    actor_id: bootstrap.user_id,
  });
  const workspace_base_path = await create_eval_workspace_base_path();
  const started_at = Date.now();
  let run_id: string | undefined;
  let status: PersistedEvalStatus = 'pass';
  let failure_reason: CanonicalFailureReason | null = null;
  const failure_messages: string[] = [];

  try {
    await run_agent_with_optional_timeout(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      prompt: task.prompt,
      provider: task.workspace_provider,
      workspace_base_path,
      actor_id: bootstrap.user_id,
      runner,
      on_run_created: (created_run_id) => {
        run_id = created_run_id;
      },
    });
  } catch (error) {
    status = 'error';
    failure_reason = failure_reason_from_error(error);
    failure_messages.push(format_error_message(error));
  }

  if (!run_id) throw new Error(`Agent eval did not create a run for task_id=${task.task_id}`);

  const workspace = await open_or_create_coding_workspace(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    run_id,
    provider: task.workspace_provider,
    workspace_base_path,
    actor_id: bootstrap.user_id,
  });
  const state: EvalTaskState = {
    db,
    task,
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    user_id: bootstrap.user_id,
    session_id: session.session_id,
    run_id,
    runtime_environment_id: workspace.runtime_environment_id,
    workspace,
    workspace_base_path,
    context_compile_ms: 0,
    started_at,
    attempt_index,
  };

  try {
    if (status === 'pass') {
      const grader_results = await grade_task_sequence(state);
      const failed_grader = grader_results.find((result) => !result.passed);
      if (failed_grader) {
        status = 'fail';
        failure_reason = failed_grader.failure_reason ?? 'grader_mismatch';
        failure_messages.push(...grader_results.flatMap((result) => result.message ?? []));
      }
    }
  } finally {
    await close_task_workspace(state).catch(() => undefined);
  }

  const duration_ms = Math.max(1, Date.now() - started_at);
  const [run, tool_calls] = await Promise.all([
    get_run(db, bootstrap.workspace_id, run_id),
    list_run_tool_calls(db, bootstrap.workspace_id, run_id),
  ]);
  const eval_report = await create_eval_report(db, {
    suite_name,
    task_source: 'internal',
    task_id: task.task_id,
    run_id,
    runtime_environment_id: state.runtime_environment_id,
    harness_version,
    runtime_version: harness_version,
    model_id: `${run?.model_provider ?? 'agent'}/${run?.model_name ?? 'unknown'}`,
    status,
    failure_reason,
    duration_ms,
    input_tokens: run?.input_tokens ?? 0,
    output_tokens: run?.output_tokens ?? 0,
    cache_read_tokens: run?.cache_read_tokens ?? 0,
    cost_microcents: run?.cost_microcents_estimate ?? run?.cost_microcents ?? 0,
    tool_call_count: tool_calls.length,
    trace_pointer: `run:${run_id}`,
    actor_id,
  });

  return {
    task_id: task.task_id,
    attempt_index,
    status,
    failure_reason,
    duration_ms,
    run_id,
    eval_report_id: eval_report.eval_report_id,
    tool_call_count: tool_calls.length,
  };
}

async function create_eval_task_state(
  db: Database,
  task: EvalTask,
  attempt_index: number,
): Promise<EvalTaskState> {
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: `Eval ${task.task_id} attempt ${attempt_index}`,
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'api',
    model_provider: 'eval',
    model_name: 'minimal-trust-loop',
    actor_id: bootstrap.user_id,
  });
  await update_run_status(db, {
    run_id: run.run_id,
    run_status: 'running',
    actor_id: bootstrap.user_id,
  });

  const workspace_base_path = await create_eval_workspace_base_path();
  const workspace = await open_or_create_coding_workspace(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    run_id: run.run_id,
    provider: task.workspace_provider,
    workspace_base_path,
    actor_id: bootstrap.user_id,
  });
  await update_session_runtime_environment(db, {
    session_id: session.session_id,
    runtime_environment_id: workspace.runtime_environment_id,
    actor_id: bootstrap.user_id,
  });

  return {
    db,
    task,
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    user_id: bootstrap.user_id,
    session_id: session.session_id,
    run_id: run.run_id,
    runtime_environment_id: workspace.runtime_environment_id,
    workspace,
    workspace_base_path,
    context_compile_ms: 0,
    started_at: Date.now(),
    attempt_index,
  };
}

async function create_eval_workspace_base_path() {
  const workspace_base_path = path.join(repository_root, '.coworker/evals/workspaces');
  await mkdir(workspace_base_path, { recursive: true });
  return workspace_base_path;
}

async function run_agent_with_optional_timeout(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    prompt: string;
    provider: EvalTask['workspace_provider'];
    workspace_base_path: string;
    actor_id: string;
    runner: Extract<EvalTask['runner'], { runner_type: 'coworker_agent' }>;
    on_run_created: (run_id: string) => void;
  },
) {
  let created_run_id: string | undefined;
  const run_promise = start_agent_run(
    db,
    {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      user_message: input.prompt,
      workspace_runtime_provider: input.provider,
      workspace_base_path: input.workspace_base_path,
      ...(input.runner.reasoning_level === undefined
        ? {}
        : { reasoning_level: input.runner.reasoning_level }),
      ...(input.runner.temperature === undefined ? {} : { temperature: input.runner.temperature }),
      ...(input.runner.max_output_tokens === undefined
        ? {}
        : { max_output_tokens: input.runner.max_output_tokens }),
      actor_id: input.actor_id,
    },
    {
      on_stream_event: (event) => {
        if (event.type === 'run_created') {
          created_run_id = event.run.run_id;
          input.on_run_created(event.run.run_id);
        }
      },
    },
  );

  const timeout_ms = input.runner.timeout_ms;
  if (timeout_ms === undefined) return run_promise;

  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run_promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          if (created_run_id) {
            void cancel_agent_run(db, {
              workspace_id: input.workspace_id,
              run_id: created_run_id,
              actor_id: input.actor_id,
            });
          }
          reject(new Error('timed_out'));
        }, timeout_ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function execute_task(state: EvalTaskState) {
  if (state.task.runner.runner_type === 'scripted_actions') {
    await execute_scripted_actions(state, state.task.runner.actions);
    return;
  }

  switch (state.task.task_id) {
    case 'ctx_001_first_message_preserved':
      await seed_many_messages(state);
      await persist_context_snapshot(state);
      return;
    case 'ctx_002_recent_tool_result_visible':
      await create_text_message(state, 'user', 'Use the latest tool result.');
      await create_text_message(state, 'tool_result', 'latest tool result: build id 42');
      await persist_context_snapshot(state);
      return;
    case 'ctx_003_persisted_summary_boundary_holds':
      await seed_summary_boundary_messages(state);
      await persist_context_snapshot(state);
      return;
    case 'ctx_004_no_hidden_context_compaction':
      await create_text_message(state, 'user', 'Do not compact hidden state.');
      await persist_context_snapshot(state);
      return;
    case 'sandbox_001_volume_ready':
      return;
    case 'sandbox_002_file_survives_fresh_process':
      await state.workspace.environment.write?.('artifacts/persisted.txt', 'fresh process ok');
      return;
    case 'sandbox_003_command_env_secret_absent':
      await execute_workspace_tool(state, 'workspace-run_command', {
        command: 'node',
        args: [
          '-e',
          [
            'process.stdout.write(JSON.stringify({',
            'openai: process.env.OPENAI_API_KEY ?? null,',
            'database: process.env.DATABASE_URL ?? null',
            '}))',
          ].join(''),
        ],
      });
      return;
    case 'sandbox_004_symlink_escape_rejected':
      await execute_workspace_tool(state, 'workspace-read_file', { path: '/etc/passwd' });
      await create_escaping_symlink(state);
      await execute_workspace_tool(state, 'workspace-read_file', { path: 'escape.txt' });
      return;
    case 'tool_001_safe_read_persists':
      await state.workspace.environment.write?.('repo/notes.txt', 'safe read');
      await execute_workspace_tool(state, 'workspace-read_file', { path: 'notes.txt' });
      return;
    case 'tool_002_risky_send_blocked':
      await execute_workspace_tool(state, 'slack-send_message-1', {
        channel_id: 'C123',
        message: 'manual approval required',
      });
      return;
    case 'tool_003_timeout_records_failure':
      await execute_workspace_tool(state, 'workspace-run_command', {
        command: 'node',
        args: ['-e', 'setTimeout(() => {}, 5000)'],
        timeout_ms: 50,
      });
      return;
    case 'tool_004_pi_coding_tools_recorded':
      await execute_workspace_tool(state, 'workspace-write_file', {
        path: 'searchable.txt',
        content: 'needle',
      });
      await execute_workspace_tool(state, 'workspace-list_files', { path: 'repo' });
      await execute_workspace_tool(state, 'workspace-grep', { pattern: 'needle', path: 'repo' });
      await execute_workspace_tool(state, 'workspace-glob', { pattern: 'repo/*.txt' });
      await execute_workspace_tool(state, 'workspace-run_command', {
        command: 'node',
        args: ['-e', 'process.stdout.write("ok")'],
      });
      return;
    case 'artifact_001_file_created_visible':
      await execute_workspace_tool(state, 'workspace-write_file', {
        path: 'artifacts/todo.txt',
        content: 'buy milk',
      });
      return;
    case 'trace_001_context_snapshot_exists':
      await create_text_message(state, 'user', 'Create a trace snapshot.');
      await persist_context_snapshot(state);
      return;
    case 'trace_002_tool_events_linked':
      await execute_workspace_tool(state, 'workspace-write_file', {
        path: 'artifacts/trace.txt',
        content: 'trace linked',
      });
      return;
    case 'run_001_cancel_releases_lock':
      await cancel_eval_run_and_release_lock(state);
      return;
    default:
      throw new Error(`No eval action for task_id=${state.task.task_id}`);
  }
}

async function execute_scripted_actions(state: EvalTaskState, actions: EvalActionSpec[]) {
  for (const action of actions) {
    if (action.action_type === 'write_file') {
      await state.workspace.environment.write?.(action.path, action.content);
      continue;
    }
    if (action.action_type === 'run_command') {
      const result = await run_workspace_command(state, action.command);
      if (result.exit_code !== 0) {
        throw new Error(`scripted action command failed: ${action.command.command}`);
      }
      continue;
    }
    if (action.action_type === 'create_message') {
      await create_text_message(state, action.role, action.text);
      continue;
    }
    if (action.action_type === 'create_context_snapshot') {
      await persist_context_snapshot(state);
      continue;
    }
    if (action.action_type === 'workspace_tool') {
      await execute_workspace_tool(state, action.tool_name, action.input ?? {});
    }
  }
}

async function seed_many_messages(state: EvalTaskState) {
  await create_text_message(state, 'user', 'original requirement: preserve this anchor');
  for (let index = 0; index < 58; index += 1) {
    await create_text_message(
      state,
      index % 2 === 0 ? 'assistant' : 'user',
      `filler message ${index}`,
    );
  }
  await create_text_message(state, 'user', 'latest request uses the original requirement');
}

async function seed_summary_boundary_messages(state: EvalTaskState) {
  await create_text_message(state, 'user', 'old hidden request');
  const boundary = await create_text_message(state, 'assistant', 'summary boundary response');
  await create_text_message(state, 'user', 'first unsummarized request');
  await create_text_message(state, 'assistant', 'recent answer');
  await update_session_context_summary(state.db, {
    workspace_id: state.workspace_id,
    session_id: state.session_id,
    context_summary: 'Persisted summary says the project uses Next.js.',
    summarized_until_message_id: boundary.run_message_id,
    actor_id: state.user_id,
  });
}

async function persist_context_snapshot(state: EvalTaskState) {
  const session = await get_session(state.db, state.workspace_id, state.session_id);
  if (!session) throw new Error('Session disappeared before context snapshot');
  const started_at = Date.now();
  const context = await build_session_context(state.db, {
    workspace_id: state.workspace_id,
    session_id: state.session_id,
    system_instructions: 'Eval worker. Use the provided runtime tools.',
    context_summary: session.context_summary,
    summarized_until_message_id: session.summarized_until_message_id,
    recent_message_limit: 6,
    recent_token_budget: 16_000,
  });
  state.context_compile_ms += Math.max(1, Date.now() - started_at);
  const tools = create_runtime_tools(state);
  const snapshot = create_model_context_snapshot({
    run_key: state.run_id,
    session_key: state.session_id,
    system_prompt: context.system_prompt,
    context_summary: context.context_summary,
    context_packets: context.context_packets,
    context_management: context.context_management,
    selection_policy: context.selection_policy,
    model: { model_provider: 'eval', model_name: 'minimal-trust-loop' },
    messages: context.messages.map(runtime_message_from_context_message),
    tools,
    environment_context: {
      runtime_environment_id: state.runtime_environment_id,
      environment_provider: state.workspace.provider,
      workspace_mount_key: state.workspace.workspace_mount_key,
      working_directory: state.workspace.environment.working_directory,
    },
    metadata: { workspace_id: state.workspace_id, agent_id: state.agent_id },
  });
  await store_run_model_context_snapshot(state.db, {
    workspace_id: state.workspace_id,
    session_id: state.session_id,
    run_id: state.run_id,
    snapshot_kind: 'engine_input',
    model_provider: 'eval',
    model_name: 'minimal-trust-loop',
    message_count: snapshot.message_count,
    tool_count: snapshot.tool_count,
    token_estimate: snapshot.token_estimate,
    snapshot: snapshot.snapshot,
    snapshot_metadata: { source: 'eval_harness' },
    actor_id: state.user_id,
  });
}

async function create_text_message(
  state: EvalTaskState,
  message_role: 'user' | 'assistant' | 'tool_result',
  text: string,
) {
  return create_run_message(state.db, {
    workspace_id: state.workspace_id,
    session_id: state.session_id,
    run_id: state.run_id,
    message_role,
    message_content: { type: 'text', text },
    source_type: message_role === 'tool_result' ? 'tool' : 'runtime',
    actor_id: state.user_id,
  });
}

async function execute_workspace_tool(
  state: EvalTaskState,
  tool_name: string,
  tool_input: unknown,
) {
  const tool = create_runtime_tools(state).find((candidate) => candidate.tool_name === tool_name);
  if (!tool?.execute) throw new Error(`Tool unavailable in eval harness: ${tool_name}`);
  return tool.execute(tool_input, create_tool_context(state));
}

async function create_escaping_symlink(state: EvalTaskState) {
  const outside_directory = await mkdtemp(path.join(tmpdir(), 'coworker-eval-escape-'));
  await writeFile(path.join(outside_directory, 'secret.txt'), 'host secret', 'utf8');
  await symlink(
    path.join(outside_directory, 'secret.txt'),
    path.join(state.workspace.host_workspace_root, 'repo', 'escape.txt'),
  );
}

async function cancel_eval_run_and_release_lock(state: EvalTaskState) {
  const lock = await acquire_session_execution_lock(state.db, {
    workspace_id: state.workspace_id,
    session_id: state.session_id,
    run_id: state.run_id,
    actor_id: state.user_id,
    lease_ms: 60_000,
  });
  if (!lock) throw new Error('Could not acquire eval cancellation lock');
  await update_run_status(state.db, {
    run_id: state.run_id,
    run_status: 'cancelled',
    actor_id: state.user_id,
  });
  await release_session_execution_lock(state.db, {
    workspace_id: state.workspace_id,
    session_id: state.session_id,
    run_id: state.run_id,
    session_status: 'cancelled',
    actor_id: state.user_id,
  });
}

async function finalize_task_state(state: EvalTaskState) {
  await finalize_task_run_record(state);
  await close_task_workspace(state);
}

async function finalize_task_run_record(state: EvalTaskState) {
  const run = await get_run(state.db, state.workspace_id, state.run_id);
  const tool_calls = await list_run_tool_calls(state.db, state.workspace_id, state.run_id);
  const tool_total_ms = tool_calls.reduce(
    (total, tool_call) => total + (tool_call.duration_ms ?? 0),
    0,
  );
  await update_run_performance_metrics(state.db, {
    run_id: state.run_id,
    context_compile_ms: state.context_compile_ms,
    engine_first_event_ms: 0,
    model_total_ms: 0,
    tool_total_ms,
    db_write_total_ms: 1,
    total_run_ms: Math.max(1, Date.now() - state.started_at),
    actor_id: state.user_id,
  });
  if (run && ['queued', 'starting', 'running', 'waiting'].includes(run.run_status)) {
    await update_run_status(state.db, {
      run_id: state.run_id,
      run_status: 'completed',
      actor_id: state.user_id,
    });
  }
}

async function close_task_workspace(state: EvalTaskState) {
  await mark_coding_workspace_idle(state.db, {
    workspace_id: state.workspace_id,
    runtime_environment_id: state.runtime_environment_id,
    close_token: state.workspace.close_token,
    actor_id: state.user_id,
  });
}

async function mark_task_failed(state: EvalTaskState, error_message: string) {
  await update_run_status(state.db, {
    run_id: state.run_id,
    run_status: 'failed',
    error_message,
    actor_id: state.user_id,
  }).catch(() => undefined);
  await finalize_task_state(state).catch(() => undefined);
}

async function grade_task_sequence(state: EvalTaskState): Promise<GraderResult[]> {
  const results: GraderResult[] = [];
  for (const grader of state.task.graders) {
    const result = await grade_task(state, grader);
    results.push(result);
    if (!result.passed) break;
  }
  return results;
}

async function grade_task(state: EvalTaskState, grader: EvalGraderSpec): Promise<GraderResult> {
  if (grader.grader_type === 'file_exists') {
    const contents = await read_workspace_file_or_null(state, grader.path);
    return contents === null ? fail('artifact_missing', `file missing: ${grader.path}`) : pass();
  }
  if (grader.grader_type === 'file_contains') {
    const contents = await read_workspace_file_or_null(state, grader.path);
    return contents?.includes(grader.text)
      ? pass()
      : fail('grader_mismatch', `file ${grader.path} does not contain ${grader.text}`);
  }
  if (grader.grader_type === 'tool_call_recorded') {
    const tool_calls = await list_run_tool_calls(state.db, state.workspace_id, state.run_id);
    return tool_calls.some((tool_call) => tool_call.tool_name === grader.tool_name)
      ? pass()
      : fail('tool_call_missing', `tool call missing: ${grader.tool_name}`);
  }
  if (grader.grader_type === 'artifact_recorded') {
    return grade_artifact_recorded(state, grader.workspace_path);
  }
  if (grader.grader_type === 'run_ended_clean') {
    const run = await get_run(state.db, state.workspace_id, state.run_id);
    return run?.run_status === 'completed'
      ? pass()
      : fail('runtime_crash', `run_status=${run?.run_status ?? 'missing'}`);
  }
  if (grader.grader_type === 'path_escape_rejected') {
    return grade_tool_error_code(state, 'path_escape');
  }
  if (grader.grader_type === 'symlink_escape_rejected') {
    return grade_tool_error_code(state, 'symlink_escape');
  }
  if (grader.grader_type === 'command_env_secret_absent') {
    return grade_command_env_secret_absent(state);
  }
  if (grader.grader_type === 'db_assertion') {
    return grade_db_assertion(state, grader.assertion);
  }
  if (grader.grader_type === 'exact_json') {
    return fail('grader_mismatch', 'exact_json is reserved for provider-response evals');
  }
  if (grader.grader_type === 'command_succeeds') {
    return grade_command_succeeds(state, grader);
  }
  if (grader.grader_type === 'command_output_contains') {
    return grade_command_output_contains(state, grader);
  }
  if (grader.grader_type === 'http_server_checks') {
    return grade_http_server_checks(state, grader);
  }
  return fail('grader_mismatch', `unsupported grader: ${JSON.stringify(grader)}`);
}

async function grade_db_assertion(state: EvalTaskState, assertion: string): Promise<GraderResult> {
  if (assertion === 'first_user_packet') {
    const snapshot = await latest_context_snapshot(state);
    return packet_names(snapshot).includes('first_user_message')
      ? pass()
      : fail('context_missing', 'first_user_message packet missing');
  }
  if (assertion === 'tool_results_packet') {
    const snapshot = await latest_context_snapshot(state);
    return packet_names(snapshot).includes('tool_results')
      ? pass()
      : fail('context_missing', 'tool_results packet missing');
  }
  if (assertion === 'persisted_summary_boundary') {
    const snapshot = await latest_context_snapshot(state);
    const management = snapshot_record(snapshot).context_management as
      | Record<string, unknown>
      | undefined;
    return management?.summary_source === 'sessions.context_summary'
      ? pass()
      : fail('context_missing', 'persisted summary packet missing');
  }
  if (assertion === 'no_hidden_context_compaction') {
    const snapshot = await latest_context_snapshot(state);
    const management = snapshot_record(snapshot).context_management as
      | Record<string, unknown>
      | undefined;
    return management?.hidden_compaction_allowed === false &&
      management.engine_compaction === 'not_invoked_by_runtime_platform'
      ? pass()
      : fail('context_missing', 'hidden compaction changed the context contract');
  }
  if (assertion === 'volume_ready') {
    const entries = await state.workspace.environment.list?.({ path: '.', max_depth: 1 });
    const names = new Set(entries?.map((entry) => entry.name) ?? []);
    return ['repo', 'artifacts', 'screenshots', 'downloads', 'logs', 'tmp'].every((name) =>
      names.has(name),
    )
      ? pass()
      : fail('sandbox_unavailable', 'workspace layout missing required directories');
  }
  if (assertion === 'fresh_process_read') {
    const fresh_workspace = await open_or_create_coding_workspace(state.db, {
      workspace_id: state.workspace_id,
      session_id: state.session_id,
      agent_id: state.agent_id,
      run_id: state.run_id,
      provider: state.task.workspace_provider,
      workspace_base_path: state.workspace_base_path,
      actor_id: state.user_id,
    });
    const contents = await fresh_workspace.environment.read?.('artifacts/persisted.txt');
    return contents === 'fresh process ok'
      ? pass()
      : fail('artifact_missing', 'fresh process could not read persisted file');
  }
  if (assertion === 'risky_send_blocked') {
    const tool_calls = await list_run_tool_calls(state.db, state.workspace_id, state.run_id);
    return tool_calls.some(
      (tool_call) =>
        tool_call.tool_name === 'slack-send_message-1' &&
        tool_call.tool_status === 'blocked' &&
        tool_call.error_code === 'approval_required',
    )
      ? pass()
      : fail('blocked_by_policy', 'Slack send was not blocked for approval');
  }
  if (assertion === 'timeout_recorded') {
    return grade_tool_error_code(state, 'timed_out');
  }
  if (assertion === 'pi_coding_tools_recorded') {
    const tool_calls = await list_run_tool_calls(state.db, state.workspace_id, state.run_id);
    const names = new Set(tool_calls.map((tool_call) => tool_call.tool_name));
    return [
      'workspace-write_file',
      'workspace-list_files',
      'workspace-grep',
      'workspace-glob',
      'workspace-run_command',
    ].every((name) => names.has(name))
      ? pass()
      : fail('tool_call_missing', 'not every coding tool call was recorded');
  }
  if (assertion === 'context_snapshot_exists') {
    const snapshots = await list_run_model_context_snapshots(
      state.db,
      state.workspace_id,
      state.run_id,
    );
    return snapshots.some((snapshot) => snapshot.snapshot_kind === 'engine_input')
      ? pass()
      : fail('context_missing', 'engine_input snapshot missing');
  }
  if (assertion === 'tool_events_linked') {
    const [tool_calls, events] = await Promise.all([
      list_run_tool_calls(state.db, state.workspace_id, state.run_id),
      list_run_events(state.db, state.workspace_id, state.run_id),
    ]);
    return tool_calls.every((tool_call) => {
      const labels = new Set(
        events
          .filter((event) => event.tool_call_id === tool_call.tool_call_id)
          .map((event) => event.event_label),
      );
      return (
        labels.has('tool_call.started') &&
        ['tool_call.completed', 'tool_call.error', 'tool_call.timed_out', 'tool_call.blocked'].some(
          (terminal_label) => labels.has(terminal_label),
        )
      );
    })
      ? pass()
      : fail('context_missing', 'tool lifecycle events are not linked to tool calls');
  }
  if (assertion === 'latency_fields_present') {
    const run = await get_run(state.db, state.workspace_id, state.run_id);
    return run && run.total_run_ms > 0 && run.db_write_total_ms > 0
      ? pass()
      : fail('runtime_crash', 'run latency waterfall was not written');
  }
  if (assertion === 'lock_released') {
    const session = await get_session(state.db, state.workspace_id, state.session_id);
    return session?.locked_by_run_id === null && session.session_status === 'cancelled'
      ? pass()
      : fail('runtime_crash', 'cancelled run did not release its session lock');
  }

  return fail('grader_mismatch', `unknown db_assertion=${assertion}`);
}

async function grade_artifact_recorded(
  state: EvalTaskState,
  workspace_path: string,
): Promise<GraderResult> {
  const files = await list_run_files(state.db, state.workspace_id, state.run_id);
  const artifact = files.find((candidate) => candidate.workspace_path === workspace_path);
  if (!artifact) return fail('artifact_missing', `artifact row missing: ${workspace_path}`);
  const opened_artifact = await open_runtime_file(state.db, {
    workspace_id: state.workspace_id,
    file_id: artifact.file_id,
    actor_id: state.user_id,
  });
  return opened_artifact.missing
    ? fail('artifact_missing', `artifact bytes missing: ${workspace_path}`)
    : pass();
}

async function grade_tool_error_code(
  state: EvalTaskState,
  error_code: CanonicalFailureReason,
): Promise<GraderResult> {
  const tool_calls = await list_run_tool_calls(state.db, state.workspace_id, state.run_id);
  return tool_calls.some((tool_call) => tool_call.error_code === error_code)
    ? pass()
    : fail(error_code, `tool error_code missing: ${error_code}`);
}

async function grade_command_env_secret_absent(state: EvalTaskState): Promise<GraderResult> {
  const tool_calls = await list_run_tool_calls(state.db, state.workspace_id, state.run_id);
  const command_call = tool_calls.find(
    (tool_call) => tool_call.tool_name === 'workspace-run_command',
  );
  const output_text = command_call?.output_text ?? '';
  try {
    const parsed = JSON.parse(output_text) as { openai?: string | null; database?: string | null };
    return parsed.openai === null && parsed.database === null
      ? pass()
      : fail('command_env_leak', 'command env included host secrets');
  } catch {
    return fail('grader_mismatch', `command output was not JSON: ${output_text}`);
  }
}

async function read_workspace_file_or_null(state: EvalTaskState, workspace_path: string) {
  try {
    return (await state.workspace.environment.read?.(workspace_path)) ?? null;
  } catch {
    return null;
  }
}

async function latest_context_snapshot(state: EvalTaskState) {
  const snapshots = await read_context_snapshots(state.db, {
    workspace_id: state.workspace_id,
    rows: await list_run_model_context_snapshots(state.db, state.workspace_id, state.run_id),
  });
  const snapshot = [...snapshots]
    .reverse()
    .find((candidate) => candidate.snapshot_kind === 'engine_input');
  if (!snapshot) throw new Error('engine_input snapshot missing');
  return snapshot.snapshot;
}

function snapshot_record(snapshot: unknown): Record<string, unknown> {
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>)
    : {};
}

function packet_names(snapshot: unknown) {
  const packets = snapshot_record(snapshot).context_packets;
  return Array.isArray(packets)
    ? packets
        .map((packet) => snapshot_record(packet).packet_name)
        .filter((packet_name): packet_name is string => typeof packet_name === 'string')
    : [];
}

function create_runtime_tools(state: EvalTaskState) {
  return create_runtime_tool_definitions(state.db, {
    workspace_id: state.workspace_id,
    session_id: state.session_id,
    run_id: state.run_id,
    agent_id: state.agent_id,
    runtime_environment_id: state.runtime_environment_id,
    environment: state.workspace.environment,
    actor_id: state.user_id,
  });
}

function create_tool_context(state: EvalTaskState): RuntimeToolContext {
  return {
    run_key: state.run_id,
    session_key: state.session_id,
    metadata: {
      eval_task_id: state.task.task_id,
      workspace_id: state.workspace_id,
    },
  };
}

function runtime_message_from_context_message(message: {
  role: string;
  content: MessageContent;
}): RuntimeAgentMessage {
  const content = message_content_to_runtime_parts(message.content);
  if (message.role === 'assistant') return { role: 'assistant', content };
  if (message.role === 'tool_result') return { role: 'tool', content };
  return { role: 'user', content };
}

function message_content_to_runtime_parts(content: MessageContent): RuntimeAgentMessage['content'] {
  if (content.text) return [{ type: 'text', text: content.text }];
  return [{ type: 'text', text: JSON.stringify(content.data ?? content) }];
}

function pass(): GraderResult {
  return { passed: true, failure_reason: null };
}

function fail(failure_reason: CanonicalFailureReason, message: string): GraderResult {
  return { passed: false, failure_reason, message };
}

function failure_reason_from_error(error: unknown): CanonicalFailureReason {
  const message = format_error_message(error);
  if (message.includes('timed_out')) return 'timed_out';
  if (message.includes('symlink_escape') || message.includes('Symlink escapes workspace')) {
    return 'symlink_escape';
  }
  if (message.includes('path_escape') || message.includes('Path escapes workspace')) {
    return 'path_escape';
  }
  if (message.includes('sandbox')) return 'sandbox_unavailable';
  return 'runtime_crash';
}

function filter_tasks(tasks: EvalTask[], options: EvalSuiteOptions) {
  if (!options.task_id) return tasks;
  return tasks.filter((task) => task.task_id === options.task_id);
}

async function current_git_version() {
  try {
    const result = await exec_file('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repository_root,
    });
    return result.stdout.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}
