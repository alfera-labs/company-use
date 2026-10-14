import { randomUUID } from 'node:crypto';
import {
  should_trace_agent_stream_events,
  trace_agent_io,
  traceable_engine_input,
} from '@agent-core/agent_io_trace';
import type { RuntimeRunEvent, RuntimeRunEventCommon } from '@agent-core/events/runtime_event';
import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import { model_config_without_credential } from '@agent-core/models/runtime_model_config';
import type {
  AgentRun,
  AgentRunResult,
  CreateAgentRunInput,
  RuntimeAgentEngine,
  RuntimeAgentEngineEvent,
  RuntimeAgentEngineInput,
} from '@agent-core/runs/agent_run';
import { add_run_usage, empty_run_usage, read_run_event_usage } from '@agent-core/runs/run_usage';
import { AppError } from '@coworker/shared';

export function create_agent_run(input: CreateAgentRunInput): AgentRun {
  const run_key = input.run_key ?? compute_stable_run_key(input);
  const metadata = input.metadata ?? {};
  const abort_controller = new AbortController();

  const event_buffer: RuntimeRunEvent[] = [];
  const waiters: Array<() => void> = [];
  let completion_promise: Promise<AgentRunResult> | null = null;
  let completed = false;
  let sequence = 0;

  function next_event_id() {
    return `evt_${randomUUID().replace(/-/g, '')}`;
  }

  function notify_waiters() {
    const pending = waiters.splice(0, waiters.length);
    for (const waiter of pending) waiter();
  }

  function push_event(event: RuntimeRunEvent) {
    event_buffer.push(event);
    notify_waiters();
  }

  function create_base_event() {
    sequence += 1;
    return {
      event_id: next_event_id(),
      event_sequence: sequence,
      run_key,
      ...(input.session_key === undefined ? {} : { session_key: input.session_key }),
    };
  }

  function start_run_once() {
    completion_promise ??= run_to_completion({
      input,
      run_key,
      metadata,
      engine: input.engine,
      signal: abort_controller.signal,
      push_event,
      create_base_event,
      mark_completed: () => {
        completed = true;
        notify_waiters();
      },
    });

    return completion_promise;
  }

  return {
    abort() {
      abort_controller.abort();
    },
    wait_for_completion() {
      return start_run_once();
    },
    usage() {
      let total = empty_run_usage();
      for (const event of event_buffer) {
        const event_usage = read_run_event_usage(event);
        if (event_usage) total = add_run_usage(total, event_usage);
      }
      return total;
    },
    async *events() {
      start_run_once();
      let cursor = 0;

      while (!completed || cursor < event_buffer.length) {
        while (cursor < event_buffer.length) {
          const event = event_buffer[cursor];
          cursor += 1;
          if (event !== undefined) yield event;
        }

        if (!completed) {
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
      }
    },
  };
}

type RunToCompletionInput = {
  input: CreateAgentRunInput;
  run_key: string;
  metadata: Record<string, unknown>;
  engine: RuntimeAgentEngine;
  signal: AbortSignal;
  push_event(event: RuntimeRunEvent): void;
  create_base_event(): RuntimeRunEventCommon;
  mark_completed(): void;
};

async function run_to_completion(options: RunToCompletionInput): Promise<AgentRunResult> {
  let final_message: RuntimeAgentMessage | undefined;
  let usage = empty_run_usage();

  try {
    options.push_event({
      ...options.create_base_event(),
      event_type: 'start',
      model: model_config_without_credential(options.input.model),
      message_count: options.input.messages.length,
      tool_count: options.input.tools.length,
      ...(Object.keys(options.metadata).length === 0 ? {} : { metadata: options.metadata }),
    });

    const engine_input = create_engine_input(options);
    trace_agent_io(
      'engine.input',
      traceable_engine_input(options.engine.engine_name, engine_input),
    );

    for await (const engine_event of options.engine.run(engine_input)) {
      if (options.signal.aborted) break;
      const mapped_event = map_engine_event(options, engine_event);
      if (mapped_event.event_type === 'message') final_message = mapped_event.message;
      const event_usage = read_run_event_usage(mapped_event);
      if (event_usage) usage = add_run_usage(usage, event_usage);
      if (mapped_event.event_type !== 'message_delta' || should_trace_agent_stream_events()) {
        trace_agent_io('engine.output_event', mapped_event);
      }
      options.push_event(mapped_event);
    }

    const status = options.signal.aborted ? 'aborted' : 'completed';
    if (status === 'completed' && final_message === undefined) {
      throw new Error('Runtime completed without an assistant message');
    }

    const end_event_base = options.create_base_event();
    const result = create_result(options, {
      status,
      usage,
      event_count: end_event_base.event_sequence,
      ...(final_message === undefined ? {} : { final_message }),
    });

    options.push_event({
      ...end_event_base,
      event_type: 'end',
      result,
    });
    trace_agent_io('run.result', result);

    return result;
  } catch (error) {
    const run_error = create_agent_run_error(error);
    trace_agent_io('run.error', {
      run_key: options.run_key,
      error,
      run_error,
    });
    options.push_event({
      ...options.create_base_event(),
      event_type: 'error',
      error: run_error,
    });

    const end_event_base = options.create_base_event();
    const result = create_result(options, {
      status: 'failed',
      usage,
      event_count: end_event_base.event_sequence,
      ...(final_message === undefined ? {} : { final_message }),
      error: run_error,
    });

    options.push_event({
      ...end_event_base,
      event_type: 'end',
      result,
    });

    return result;
  } finally {
    options.mark_completed();
  }
}

function create_engine_input(options: RunToCompletionInput): RuntimeAgentEngineInput {
  return {
    run_key: options.run_key,
    ...(options.input.session_key === undefined ? {} : { session_key: options.input.session_key }),
    system_prompt: options.input.system_prompt,
    model: options.input.model,
    messages: options.input.messages,
    tools: options.input.tools,
    ...(options.input.environment === undefined ? {} : { environment: options.input.environment }),
    metadata: options.metadata,
    signal: options.signal,
    ...(options.input.decide_tool_batch === undefined
      ? {}
      : { decide_tool_batch: options.input.decide_tool_batch }),
    ...(options.input.before_turn === undefined ? {} : { before_turn: options.input.before_turn }),
  };
}

function map_engine_event(
  options: RunToCompletionInput,
  engine_event: RuntimeAgentEngineEvent,
): RuntimeRunEvent {
  if (engine_event.type === 'message') {
    return {
      ...options.create_base_event(),
      event_type: 'message',
      message: engine_event.message,
    };
  }

  if (engine_event.type === 'message_delta') {
    return {
      ...options.create_base_event(),
      event_type: 'message_delta',
      delta: engine_event.delta,
      accumulated_text: engine_event.accumulated_text,
      ...(engine_event.content_index === undefined
        ? {}
        : { content_index: engine_event.content_index }),
      ...(engine_event.metadata === undefined ? {} : { metadata: engine_event.metadata }),
    };
  }

  return {
    ...options.create_base_event(),
    event_type: 'progress',
    label: engine_event.label,
    ...(engine_event.delta === undefined ? {} : { delta: engine_event.delta }),
    ...(engine_event.content === undefined ? {} : { content: engine_event.content }),
    ...(engine_event.content_index === undefined
      ? {}
      : { content_index: engine_event.content_index }),
    ...(engine_event.metadata === undefined ? {} : { metadata: engine_event.metadata }),
  };
}

function create_result(
  options: RunToCompletionInput,
  result: Omit<AgentRunResult, 'run_key' | 'session_key' | 'metadata'>,
): AgentRunResult {
  return {
    run_key: options.run_key,
    ...(options.input.session_key === undefined ? {} : { session_key: options.input.session_key }),
    ...result,
    metadata: options.metadata,
  };
}

function compute_stable_run_key(input: CreateAgentRunInput) {
  const stable_input = JSON.stringify({
    system_prompt: input.system_prompt,
    model: input.model,
    messages: input.messages,
    tools: input.tools.map((tool) => tool.tool_name),
  });

  return `run_${fnv1a(stable_input)}`;
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function create_agent_run_error(error: unknown) {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'agent_run_failed',
      message: error.message,
    };
  }

  return {
    code: 'agent_run_failed',
    message: 'Unknown agent run failure',
  };
}
