import { create_browser_tool, read_browser_command } from '@agent-core/browser/browser_tool';
import type { BrowserSession } from '@agent-core/browser/types';
import { create_pi_engine } from '@agent-core/engines/pi/pi_engine';
import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import type { RuntimeAgentEngine } from '@agent-core/runs/agent_run';
import {
  add_run_usage,
  empty_run_usage,
  read_engine_event_usage,
} from '@agent-core/runs/run_usage';
import type {
  RuntimeJsonSchema,
  RuntimeToolContext,
  RuntimeToolDefinition,
} from '@agent-core/tools/runtime_tool';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import { format_error_message } from '@coworker/shared';

type BrowserAgentAction = {
  command: string;
  duration_ms: number;
  exit_code: number;
};

export type BrowserAgentActionEvent = BrowserAgentAction & {
  step: number;
  ok: boolean;
  output_text: string;
};

export type BrowserAgentObserver = {
  on_action?: (event: BrowserAgentActionEvent) => void | Promise<void>;
};

export type BrowserAgentResult = {
  final_text: string;
  step_count: number;
  actions: BrowserAgentAction[];
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  error_code?: string;
  error_message?: string;
};

export type RunBrowserAgentInput = {
  session: BrowserSession;
  goal: string;
  start_url?: string;
  system_prompt: string;
  model: RuntimeModelConfig;
  engine?: RuntimeAgentEngine;
  max_steps?: number;
  run_key?: string;
  session_key?: string;
  signal?: AbortSignal;
  observer?: BrowserAgentObserver;
};

export const default_browser_max_steps = 150;

export async function run_browser_agent(input: RunBrowserAgentInput): Promise<BrowserAgentResult> {
  const engine = input.engine ?? create_pi_engine();
  const stop = new AbortController();
  const loop = create_browser_agent_loop(
    input.max_steps ?? default_browser_max_steps,
    stop,
    input.observer,
  );
  const tool = browser_tool_under_loop_control(create_browser_tool(input.session), loop);

  const forward_abort = () => stop.abort();
  input.signal?.addEventListener('abort', forward_abort, { once: true });
  if (input.signal?.aborted) stop.abort();

  let usage = empty_run_usage();
  let final_text = '';
  let step_count = 0;

  try {
    const events = engine.run({
      run_key: input.run_key ?? input.session.id,
      ...(input.session_key === undefined ? {} : { session_key: input.session_key }),
      system_prompt: input.system_prompt,
      model: input.model,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: build_goal_prompt(input.goal, input.start_url) }],
        },
      ],
      tools: [tool],
      metadata: {},
      signal: stop.signal,
    });
    for await (const event of events) {
      usage = add_run_usage(usage, read_engine_event_usage(event) ?? empty_run_usage());
      if (event.type !== 'message' || event.message.role !== 'assistant') continue;
      step_count += 1;
      const text = assistant_message_text(event.message);
      if (text) final_text = text;
    }
  } catch (error) {
    if (!(loop.stopped && error instanceof Error && error.name === 'AbortError')) throw error;
  } finally {
    input.signal?.removeEventListener('abort', forward_abort);
  }

  return {
    final_text: loop.error_message ?? final_text,
    step_count,
    actions: loop.actions,
    input_tokens: usage.input,
    output_tokens: usage.output,
    total_tokens: usage.totalTokens,
    ...(loop.error_code === undefined ? {} : { error_code: loop.error_code }),
    ...(loop.error_message === undefined ? {} : { error_message: loop.error_message }),
  };
}

export const browse_tool_name = 'browse';

export const browse_tool_input_schema: RuntimeJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['task'],
  properties: {
    task: {
      type: 'string',
      description:
        'A complete web task to hand to the browser sub-agent, in plain language — e.g. "find the cheapest direct flight from SFO to Tokyo next month and report the price and airline". The sub-agent operates the browser and returns the result.',
    },
    start_url: {
      type: 'string',
      description: 'Optional URL to open first.',
    },
  },
};

export const browse_tool_description =
  'Delegate a whole web task to the browser sub-agent. It operates a real browser (navigate, read, click, fill, extract) on its own and returns the outcome — you do not issue individual browser commands yourself.';

export function create_browse_tool(deps: {
  session: BrowserSession;
  system_prompt: string;
  model: RuntimeModelConfig;
  engine?: RuntimeAgentEngine;
  max_steps?: number;
}): RuntimeToolDefinition {
  return {
    tool_name: browse_tool_name,
    description: browse_tool_description,
    input_schema: browse_tool_input_schema,
    execution_mode: 'sequential',
    metadata: { display_name: 'Browse the web', source_package: '@agent-core' },
    execute: (input, context) => execute_browse(deps, input, context),
  };
}

async function execute_browse(
  deps: {
    session: BrowserSession;
    system_prompt: string;
    model: RuntimeModelConfig;
    engine?: RuntimeAgentEngine;
    max_steps?: number;
  },
  input: unknown,
  context: RuntimeToolContext,
): Promise<RuntimeToolResult> {
  const { goal, start_url } = read_browse_input(input);
  if (!goal) {
    return {
      ok: false,
      error_code: 'invalid_browse_input',
      error_message: 'The browse tool needs a non-empty "task" string.',
    };
  }
  try {
    const result = await run_browser_agent({
      session: deps.session,
      goal,
      ...(start_url === undefined ? {} : { start_url }),
      system_prompt: deps.system_prompt,
      model: deps.model,
      ...(deps.engine === undefined ? {} : { engine: deps.engine }),
      ...(deps.max_steps === undefined ? {} : { max_steps: deps.max_steps }),
      run_key: context.run_key,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    });
    if (result.error_message) {
      return {
        ok: false,
        error_code: result.error_code ?? 'browser_unavailable',
        error_message: result.error_message,
        metadata: { step_count: result.step_count, total_tokens: result.total_tokens },
      };
    }
    return {
      ok: true,
      content_text: result.final_text,
      metadata: { step_count: result.step_count, total_tokens: result.total_tokens },
    };
  } catch (error) {
    return {
      ok: false,
      error_code: 'browser_unavailable',
      error_message: format_error_message(error),
    };
  }
}

export function read_browse_input(input: unknown): { goal: string; start_url?: string } {
  if (!input || typeof input !== 'object') return { goal: '' };
  const record = input as { task?: unknown; start_url?: unknown };
  const goal = typeof record.task === 'string' ? record.task.trim() : '';
  const start_url = typeof record.start_url === 'string' ? record.start_url.trim() : '';
  return start_url ? { goal, start_url } : { goal };
}

function build_goal_prompt(goal: string, start_url: string | undefined): string {
  if (!start_url) return goal;
  return `${goal}\n\nStart by opening ${start_url}.`;
}

type BrowserAgentLoop = {
  max_steps: number;
  actions: BrowserAgentAction[];
  budget_refusals: number;
  error_code?: string;
  error_message?: string;
  stopped: boolean;
  stop(): void;
  observer?: BrowserAgentObserver | undefined;
};

function create_browser_agent_loop(
  max_steps: number,
  stop: AbortController,
  observer: BrowserAgentObserver | undefined,
): BrowserAgentLoop {
  const loop: BrowserAgentLoop = {
    max_steps,
    actions: [],
    budget_refusals: 0,
    stopped: false,
    stop() {
      loop.stopped = true;
      stop.abort();
    },
    observer,
  };
  return loop;
}

function browser_tool_under_loop_control(
  tool: RuntimeToolDefinition,
  loop: BrowserAgentLoop,
): RuntimeToolDefinition {
  const execute = tool.execute;
  if (!execute) throw new Error('browser tool has no executor');
  return {
    ...tool,
    execute: async (tool_input, context) => {
      if (loop.actions.length >= loop.max_steps) return refuse_command_over_budget(loop);

      const result = await execute(tool_input, context);
      const action = browser_agent_action(read_browser_command(tool_input), result);
      loop.actions.push(action);
      await loop.observer?.on_action?.({
        ...action,
        step: loop.actions.length,
        ok: result.ok,
        output_text: action_output_text(result),
      });
      if (!result.ok && is_browser_unavailable(result.error_code)) {
        loop.error_code = result.error_code;
        loop.error_message = result.error_message;
        loop.stop();
      }
      return result;
    },
  };
}

function refuse_command_over_budget(loop: BrowserAgentLoop): RuntimeToolResult {
  loop.budget_refusals += 1;
  const error_message = `You have used all ${loop.max_steps} browser commands for this task. Do not call the browser again — give your final answer now from what you have already seen.`;
  if (loop.budget_refusals > 1) loop.stop();
  if (loop.stopped) {
    loop.error_code = 'browser_step_budget_exhausted';
    loop.error_message = error_message;
  }
  return {
    ok: false,
    error_code: 'browser_step_budget_exhausted',
    error_message,
  };
}

function browser_agent_action(command: string, result: RuntimeToolResult): BrowserAgentAction {
  const metadata = result.metadata ?? {};
  return {
    command,
    duration_ms: metadata.duration_ms ?? 0,
    exit_code: metadata.exit_code ?? (result.ok ? 0 : 1),
  };
}

function action_output_text(result: RuntimeToolResult): string {
  if (result.ok) return result.content_text ?? '';
  return result.error_message;
}

function is_browser_unavailable(error_code: string): boolean {
  return error_code === 'browser_not_installed' || error_code === 'browser_unavailable';
}

function assistant_message_text(message: RuntimeAgentMessage): string {
  return message.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim();
}
