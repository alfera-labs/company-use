import {
  type BrowserAgentActionEvent,
  type BrowserAgentObserver,
  browse_tool_description,
  browse_tool_input_schema,
  browse_tool_name,
  read_browse_input,
  run_browser_agent,
} from '@agent-core/browser/browse_agent';
import { create_browser_session } from '@agent-core/browser/browser_session';
import { create_browser_tool, load_browser_skill_prompt } from '@agent-core/browser/browser_tool';
import type { BrowserSession } from '@agent-core/browser/types';
import { create_pi_engine } from '@agent-core/engines/pi/pi_engine';
import type { SessionEnv } from '@agent-core/environment/session_env';
import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import type { RuntimeAgentEngine } from '@agent-core/runs/agent_run';
import type { RuntimeToolContext, RuntimeToolDefinition } from '@agent-core/tools/runtime_tool';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  add_usage_to_run_totals,
  create_run,
  create_tool_call_started,
  get_run,
  update_run_performance_metrics,
  update_run_status,
  update_tool_call_finished,
} from '@coworker/core/db/queries/sessions';
import { format_error_message, resolve_model_profile } from '@coworker/shared';
import {
  type BrowserLiveView,
  create_browser_live_view,
} from '@runtime-platform/tools/browser_live_view';
import {
  type ChatStreamEventDraftSink,
  create_logged_tool_definition,
  type RuntimeToolPolicy,
} from '@runtime-platform/tools/tool_execution_service';

export type BrowserHarnessMode = 'off' | 'direct' | 'subagent';

const max_recorded_output_chars = 16_000;

export function resolve_browser_harness_mode(): BrowserHarnessMode {
  return env.COWORKER_BROWSER_HARNESS_MODE;
}

export function resolve_browser_model(): RuntimeModelConfig & { model_proxy: string } {
  return resolve_model_profile('browser_agent', env);
}

export function resolve_browser_max_steps(): number {
  return env.COWORKER_BROWSER_MAX_STEPS;
}

export type BrowserToolAssemblyInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  agent_id?: string | undefined;
  runtime_environment_id?: string | undefined;
  environment?: SessionEnv | undefined;
  emit_chat_stream_event_drafts?: ChatStreamEventDraftSink | undefined;
  tool_result_is_user_visible?: boolean | undefined;
  actor_id: string;
};

const browser_command_policy: RuntimeToolPolicy = {
  timeout_ms: 120_000,
  output_limit_bytes: 16_000,
  risk_class: 'write',
  approval_mode: 'auto',
  sandbox_required: false,
};

const browse_tool_policy: RuntimeToolPolicy = {
  timeout_ms: 0,
  output_limit_bytes: 16_000,
  risk_class: 'write',
  approval_mode: 'auto',
  sandbox_required: false,
};

export function is_browser_available(
  environment: SessionEnv | undefined,
  mode: BrowserHarnessMode = resolve_browser_harness_mode(),
): environment is SessionEnv {
  return (
    mode !== 'off' &&
    !!environment &&
    environment.env_kind === 'remote_sandbox' &&
    !!environment.exec
  );
}

export function create_browser_tool_definitions(
  db: Database,
  input: BrowserToolAssemblyInput,
  mode: BrowserHarnessMode = resolve_browser_harness_mode(),
  engine: RuntimeAgentEngine = create_pi_engine(),
): RuntimeToolDefinition[] {
  const environment = input.environment;
  if (!is_browser_available(environment, mode)) {
    return [];
  }

  const session = create_browser_session(environment, {
    default_command_timeout_ms: env.COWORKER_BROWSER_COMMAND_TIMEOUT_MS,
  });
  const live_view = create_browser_live_view(db, {
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
    environment,
    ...(input.runtime_environment_id
      ? { runtime_environment_id: input.runtime_environment_id }
      : {}),
  });

  if (mode === 'direct') {
    return [
      create_logged_tool_definition(
        db,
        input,
        with_browser_live_view(create_browser_tool(session), live_view),
        browser_command_policy,
      ),
    ];
  }

  return [
    create_logged_tool_definition(
      db,
      input,
      create_logged_browse_tool(db, input, session, engine, live_view),
      browse_tool_policy,
    ),
  ];
}

function create_logged_browse_tool(
  db: Database,
  input: BrowserToolAssemblyInput,
  session: BrowserSession,
  engine: RuntimeAgentEngine,
  live_view: BrowserLiveView,
): RuntimeToolDefinition {
  const load_system_prompt = memoize_skill_prompt(session);

  return {
    tool_name: browse_tool_name,
    description: browse_tool_description,
    input_schema: browse_tool_input_schema,
    execution_mode: 'sequential',
    metadata: { display_name: 'Browse the web', source_package: '@coworker/runtime-platform' },
    execute: (tool_input, context) =>
      execute_logged_browse(
        db,
        input,
        session,
        engine,
        live_view,
        load_system_prompt,
        tool_input,
        context,
      ),
  };
}

async function execute_logged_browse(
  db: Database,
  input: BrowserToolAssemblyInput,
  session: BrowserSession,
  engine: RuntimeAgentEngine,
  live_view: BrowserLiveView,
  load_system_prompt: () => Promise<string>,
  tool_input: unknown,
  context: RuntimeToolContext,
): Promise<RuntimeToolResult> {
  const { goal, start_url } = read_browse_input(tool_input);
  if (!goal) {
    return {
      ok: false,
      error_code: 'invalid_browse_input',
      error_message: 'The browse tool needs a non-empty "task" string.',
    };
  }

  const child = await open_browser_child_run(db, input);
  const started_at = Date.now();
  try {
    const system_prompt = await load_system_prompt();
    const result = await run_browser_agent({
      session,
      goal,
      ...(start_url === undefined ? {} : { start_url }),
      system_prompt,
      model: resolve_browser_model(),
      engine,
      max_steps: resolve_browser_max_steps(),
      run_key: child?.run_id ?? context.run_key,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
      observer: browser_action_observer(db, input, child?.run_id, live_view),
    });
    if (result.error_message) {
      if (child) {
        await finish_browser_child_run(db, input, child.run_id, {
          run_status: 'failed',
          error_message: result.error_message,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          total_run_ms: Date.now() - started_at,
        });
      }
      return {
        ok: false,
        error_code: result.error_code ?? 'browser_unavailable',
        error_message: result.error_message,
        metadata: {
          step_count: result.step_count,
          total_tokens: result.total_tokens,
          ...(child ? { browser_run_id: child.run_id } : {}),
        },
      };
    }
    if (child) {
      await finish_browser_child_run(db, input, child.run_id, {
        run_status: 'completed',
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        total_run_ms: Date.now() - started_at,
      });
    }
    return {
      ok: true,
      content_text: result.final_text,
      metadata: {
        step_count: result.step_count,
        total_tokens: result.total_tokens,
        ...(child ? { browser_run_id: child.run_id } : {}),
      },
    };
  } catch (error) {
    const error_message = format_error_message(error);
    if (child) {
      await finish_browser_child_run(db, input, child.run_id, {
        run_status: 'failed',
        error_message,
        total_run_ms: Date.now() - started_at,
      }).catch(() => undefined);
    }
    return { ok: false, error_code: 'browser_unavailable', error_message };
  }
}

async function open_browser_child_run(
  db: Database,
  input: BrowserToolAssemblyInput,
): Promise<{ run_id: string } | null> {
  if (!input.agent_id) return null;
  const parent = await get_run(db, input.workspace_id, input.run_id);
  const model = resolve_browser_model();
  const child = await create_run(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    agent_id: input.agent_id,
    trigger_type: 'api',
    parent_run_id: input.run_id,
    root_run_id: parent?.root_run_id ?? input.run_id,
    model_provider: model.model_provider,
    model_proxy: model.model_proxy,
    model_name: model.model_name,
    actor_id: input.actor_id,
  });
  await update_run_status(db, {
    run_id: child.run_id,
    run_status: 'running',
    actor_id: input.actor_id,
  });
  return { run_id: child.run_id };
}

function browser_action_observer(
  db: Database,
  input: BrowserToolAssemblyInput,
  child_run_id: string | undefined,
  live_view: BrowserLiveView,
): BrowserAgentObserver {
  return {
    on_action: async (event) => {
      if (event.ok) void live_view.open();
      if (child_run_id) await record_browser_action(db, input, child_run_id, event);
    },
  };
}

async function record_browser_action(
  db: Database,
  input: BrowserToolAssemblyInput,
  child_run_id: string,
  event: BrowserAgentActionEvent,
) {
  const tool_call = await create_tool_call_started(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: child_run_id,
    ...(input.agent_id ? { agent_id: input.agent_id } : {}),
    tool_name: 'agent-browser',
    tool_input: { command: event.command },
    risk_class: 'write',
    actor_id: input.actor_id,
  });
  await update_tool_call_finished(db, {
    tool_call_id: tool_call.tool_call_id,
    tool_status: event.ok ? 'completed' : 'failed',
    output_text: event.output_text.slice(0, max_recorded_output_chars),
    ...(event.ok ? {} : { error_code: `exit_${event.exit_code}` }),
    duration_ms: event.duration_ms,
    actor_id: input.actor_id,
  });
}

function with_browser_live_view(
  tool: RuntimeToolDefinition,
  live_view: BrowserLiveView,
): RuntimeToolDefinition {
  return {
    ...tool,
    execute: async (input, context) => {
      if (!tool.execute) {
        return {
          ok: false,
          error_code: 'browser_unavailable',
          error_message: 'The browser tool is not executable.',
        };
      }
      const result = await tool.execute(input, context);
      if (result.ok) void live_view.open();
      return result;
    },
  };
}

async function finish_browser_child_run(
  db: Database,
  input: BrowserToolAssemblyInput,
  child_run_id: string,
  outcome: {
    run_status: 'completed' | 'failed';
    input_tokens?: number;
    output_tokens?: number;
    error_message?: string;
    total_run_ms: number;
  },
) {
  if (outcome.input_tokens !== undefined || outcome.output_tokens !== undefined) {
    await add_usage_to_run_totals(db, {
      run_id: child_run_id,
      input_tokens: outcome.input_tokens ?? 0,
      output_tokens: outcome.output_tokens ?? 0,
      actor_id: input.actor_id,
    });
  }
  await update_run_performance_metrics(db, {
    run_id: child_run_id,
    total_run_ms: outcome.total_run_ms,
    actor_id: input.actor_id,
  });
  await update_run_status(db, {
    run_id: child_run_id,
    run_status: outcome.run_status,
    ...(outcome.error_message === undefined ? {} : { error_message: outcome.error_message }),
    actor_id: input.actor_id,
  });
}

function memoize_skill_prompt(session: BrowserSession): () => Promise<string> {
  let pending: Promise<string> | undefined;
  return () => {
    if (!pending) pending = load_browser_skill_prompt(session);
    return pending;
  };
}
