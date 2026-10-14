import {
  is_agent_io_trace_on,
  should_trace_agent_stream_events,
  trace_agent_io,
} from '@agent-core/agent_io_trace';
import {
  defer_tools_in_anthropic_payload,
  measure_tool_block,
  provider_loads_deferred_tools,
  read_tool_deferral_policy,
} from '@agent-core/engines/pi/pi_deferred_tools';
import {
  pi_assistant_message_to_runtime_message,
  runtime_message_content_to_text,
  runtime_message_to_pi_message,
  runtime_messages_to_pi_messages,
} from '@agent-core/engines/pi/pi_messages';
import {
  describe_pi_model,
  get_pi_model,
  get_pi_runtime_provider_name,
  resolve_runtime_model_api_key,
} from '@agent-core/engines/pi/pi_model';
import { get_pi_models } from '@agent-core/engines/pi/pi_models';
import { create_progress_event } from '@agent-core/engines/pi/pi_progress_event';
import {
  streamed_text_to_runtime_message,
  tool_end_events,
} from '@agent-core/engines/pi/pi_text_messages';
import { create_pi_tool_batch_decider } from '@agent-core/engines/pi/pi_tool_batch';
import { runtime_tools_to_pi_tools } from '@agent-core/engines/pi/pi_tools';
import {
  create_pi_turn_steering,
  read_pi_turn_state,
} from '@agent-core/engines/pi/pi_turn_steering';
import { make_messages_well_formed } from '@agent-core/messages/message_integrity';
import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import {
  model_config_without_credential,
  type RuntimeModelConfig,
} from '@agent-core/models/runtime_model_config';
import type {
  RuntimeAgentEngine,
  RuntimeAgentEngineEvent,
  RuntimeAgentEngineInput,
} from '@agent-core/runs/agent_run';
import {
  add_run_usage,
  empty_run_usage,
  read_message_usage,
  retried_call_event_label,
} from '@agent-core/runs/run_usage';
import { calculate_backoff_delay, require_model_use_case_policy, sleep } from '@coworker/shared';
import type { AgentMessage, BeforeToolCallContext, StreamFn } from '@earendil-works/pi-agent-core';
import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core';
import {
  type Api,
  isRetryableAssistantError,
  type Model,
  type ModelsSimpleStreamOptions,
  type ModelThinkingLevel,
  type ProviderResponse,
} from '@earendil-works/pi-ai';

export function create_pi_engine(): RuntimeAgentEngine {
  return {
    engine_name: 'agent-core/pi',
    async *run(input) {
      yield* run_pi_agent(input);
    },
  };
}

async function* run_pi_agent(
  input: RuntimeAgentEngineInput,
): AsyncIterable<RuntimeAgentEngineEvent> {
  const { pi_model, api_key } = read_runnable_pi_model(input);
  const well_formed_messages = make_messages_well_formed(input.messages);
  const { prompt, history } = split_prompt_from_history(well_formed_messages);
  const queue = create_event_queue<RuntimeAgentEngineEvent>();
  const streamed_text_by_index = new Map<number, string>();
  const pi_messages = runtime_messages_to_pi_messages(history);
  const batch_decider = input.decide_tool_batch
    ? create_pi_tool_batch_decider(input.decide_tool_batch)
    : undefined;
  const pi_tools = runtime_tools_to_pi_tools(input, batch_decider);
  const prompt_text = prompt ? runtime_message_content_to_text(prompt.content) : undefined;
  const pi_prompt = prompt ? runtime_message_to_pi_message(prompt) : undefined;
  const steering = create_pi_turn_steering();

  trace_agent_io('pi.input', {
    run_key: input.run_key,
    ...(input.session_key === undefined ? {} : { session_key: input.session_key }),
    system_prompt: input.system_prompt,
    runtime_model: model_config_without_credential(input.model),
    pi_model: describe_pi_model(input.model),
    prompt: prompt_text,
    history: pi_messages,
    tools: pi_tools.map(traceable_pi_tool),
  });

  let message_emitted_for_run = false;
  let message_emitted_for_turn = false;
  let terminal_assistant_message: AgentMessage | undefined;
  let turn_index = 0;
  let run_usage = empty_run_usage();
  // pi catches a throw from a listener and rewrites the run's ending into a generic failure
  // message, so the original error is held here and reported in place of that rewrite.
  let before_turn_error: unknown;
  const retry_budget: RetryBudget = {
    attempts_used: 0,
    max_attempts: require_model_use_case_policy('agent_run').maximum_retry_attempts,
  };

  const agent = new Agent({
    initialState: {
      systemPrompt: input.system_prompt,
      model: pi_model,
      thinkingLevel: get_pi_thinking_level(input.model.reasoning_level),
      messages: pi_messages,
      tools: pi_tools,
    },
    sessionId: input.session_key ?? input.run_key,
    transport: 'auto',
    toolExecution: 'parallel',
    transformContext: steering.transform_context,
    getApiKey() {
      return api_key;
    },
    ...(batch_decider
      ? {
          async beforeToolCall(context: BeforeToolCallContext) {
            await batch_decider.settle_batch_once(context.assistantMessage, input.signal);
            return undefined;
          },
        }
      : {}),
    streamFn: create_traced_stream_fn({
      run_key: input.run_key,
      ...(input.session_key === undefined ? {} : { session_key: input.session_key }),
    }),
  });

  const read_turn_state = (turn_index: number) =>
    read_pi_turn_state({ turn_index, usage: run_usage, agent, pi_prompt, pi_model });

  const unsubscribe = agent.subscribe(async (event) => {
    if (input.signal.aborted) agent.abort();
    if (should_trace_agent_stream_events()) trace_agent_io('pi.raw_event', event);

    if (event.type === 'agent_end') {
      terminal_assistant_message = latest_agent_message(event.messages);
    }

    if (event.type === 'turn_start') {
      turn_index += 1;
      // pi awaits this listener before it issues the turn's model request, so a throw here costs
      // the run nothing. It runs before the per-turn bookkeeping below is reset on purpose: the
      // stopped turn then keeps the previous turn's emitted-message state, and pi's own failure
      // message cannot land in the transcript as an empty assistant turn.
      if (input.before_turn) {
        try {
          const decision = await input.before_turn(read_turn_state(turn_index));
          steering.accept(decision, turn_index).forEach(queue.push);
        } catch (error) {
          before_turn_error = error;
          throw error;
        }
      }

      streamed_text_by_index.clear();
      message_emitted_for_turn = false;
    }

    collect_text_delta(event, streamed_text_by_index);

    const retry_follows =
      before_turn_error === undefined &&
      !input.signal.aborted &&
      should_retry_assistant_error(read_event_assistant_message(event), retry_budget);
    if (retry_follows && event.type === 'message_end') {
      run_usage = add_agent_message_usage(run_usage, event.message, input.model);
    }
    if (event.type === 'message_end' && is_successful_assistant_message(event.message)) {
      retry_budget.attempts_used = 0;
    }

    for (const mapped_event of pi_event_to_runtime_events(event, input.model, {
      can_emit_turn_message: !message_emitted_for_turn,
      can_emit_run_message: !message_emitted_for_run,
      streamed_text: join_streamed_text(streamed_text_by_index),
    })) {
      if (mapped_event.type === 'message' && retry_follows) continue;
      if (mapped_event.type === 'message') {
        message_emitted_for_run = true;
        message_emitted_for_turn = true;
        const message_usage = read_message_usage(mapped_event.message);
        if (message_usage) run_usage = add_run_usage(run_usage, message_usage);
      }

      queue.push(mapped_event);
    }
  });

  const abort_agent = () => agent.abort();
  input.signal.addEventListener('abort', abort_agent, { once: true });

  const run_promise = pi_prompt ? agent.prompt(pi_prompt) : agent.continue();

  // The aborted-signal check comes after prompt()/continue(): pi's abort() targets the run it is
  // currently executing, which exists only once one of those calls has started it. Checked before,
  // a cancel that lands during run setup is a silent no-op: the agent keeps running and keeps
  // calling tools against live accounts after the user pressed cancel.
  if (input.signal.aborted) agent.abort();

  void run_agent_with_retries(agent, run_promise, {
    queue,
    signal: input.signal,
    model: input.model,
    retry_budget,
    read_outcome: () => ({ before_turn_error, terminal_assistant_message }),
  })
    .catch(queue.fail)
    .finally(() => {
      input.signal.removeEventListener('abort', abort_agent);
      unsubscribe();
    })
    .catch(() => undefined);

  for await (const event of queue) yield event;
}

function read_runnable_pi_model(input: RuntimeAgentEngineInput) {
  const pi_model = get_pi_model(input.model);
  if (!pi_model) {
    throw new Error(`Pi model not found for ${describe_runtime_model(input.model)}`);
  }
  if (input.messages.some((message) => message.content.some((part) => part.type === 'image'))) {
    if (!pi_model.input.includes('image')) {
      throw new Error(`${describe_runtime_model(input.model)} does not support image input`);
    }
  }

  const api_key = resolve_runtime_model_api_key(input.model);
  if (!api_key) {
    throw new Error(`No API key configured for ${get_pi_runtime_provider_name(input.model)}`);
  }
  return { pi_model, api_key };
}

type RuntimeEventQueue = ReturnType<typeof create_event_queue<RuntimeAgentEngineEvent>>;

type RetryBudget = { attempts_used: number; max_attempts: number };

type PiAgentRun = {
  queue: RuntimeEventQueue;
  signal: AbortSignal;
  model: RuntimeModelConfig;
  retry_budget: RetryBudget;
  read_outcome: () => {
    before_turn_error: unknown;
    terminal_assistant_message: AgentMessage | undefined;
  };
};

// An error the provider sends inside an already-open stream ends pi's loop on the spot, and the
// request-level maxRetries never sees it. An overloaded error that arrives while the model streams
// its final answer would fail the whole run after all its tool work is done. A transient failure
// drops the failed attempt and asks the model again from the same transcript, with backoff.
async function run_agent_with_retries(agent: Agent, first_attempt: Promise<void>, run: PiAgentRun) {
  await first_attempt;

  for (;;) {
    const { before_turn_error, terminal_assistant_message } = run.read_outcome();
    if (before_turn_error !== undefined) return run.queue.fail(before_turn_error);

    if (
      terminal_assistant_message?.role !== 'assistant' ||
      !should_retry_assistant_error(terminal_assistant_message, run.retry_budget)
    ) {
      const model_name = describe_runtime_model(run.model);
      return settle_pi_agent_run(run.queue, terminal_assistant_message, run.signal, model_name);
    }

    if (!run.signal.aborted) await wait_before_retry(agent, terminal_assistant_message, run);
    if (run.signal.aborted) return run.queue.close();

    await agent.continue();
  }
}

async function wait_before_retry(
  agent: Agent,
  failed_message: Extract<AgentMessage, { role: 'assistant' }>,
  run: PiAgentRun,
) {
  // pi continues only from a user or tool-result message, and the failed attempt must not reach
  // the model as part of the transcript it is asked to answer again.
  if (agent.state.messages.at(-1) !== failed_message) {
    throw new Error('Cannot retry the model call: the failed attempt is not the latest message');
  }
  agent.state.messages = agent.state.messages.slice(0, -1);

  run.retry_budget.attempts_used += 1;
  const attempt = run.retry_budget.attempts_used;
  const delay_ms = calculate_backoff_delay(attempt, { base_ms: 1000 });
  run.queue.push(
    create_progress_event(retried_call_event_label, undefined, {
      ...model_event_metadata(run.model),
      attempt,
      max_attempts: run.retry_budget.max_attempts,
      delay_ms,
      error_message: failed_message.errorMessage,
      usage: read_message_usage(agent_message_to_runtime_message(failed_message, run.model)),
    }),
  );

  await sleep(delay_ms, run.signal);
}

function should_retry_assistant_error(message: AgentMessage | undefined, budget: RetryBudget) {
  return (
    message?.role === 'assistant' &&
    isRetryableAssistantError(message) &&
    budget.attempts_used < budget.max_attempts
  );
}

function read_event_assistant_message(event: AgentEvent) {
  if (event.type === 'message_end' || event.type === 'turn_end') return event.message;
  if (event.type === 'agent_end') return latest_agent_message(event.messages);
  return undefined;
}

function is_successful_assistant_message(message: AgentMessage) {
  return message.role === 'assistant' && message.stopReason !== 'error';
}

function add_agent_message_usage(
  usage: ReturnType<typeof empty_run_usage>,
  message: AgentMessage,
  model: RuntimeModelConfig,
) {
  const message_usage = read_message_usage(agent_message_to_runtime_message(message, model));
  return message_usage ? add_run_usage(usage, message_usage) : usage;
}

function model_event_metadata(model: RuntimeModelConfig) {
  return {
    provider: get_pi_runtime_provider_name(model),
    model_provider: model.model_provider,
    model_proxy: model.model_proxy ?? model.model_provider,
    model: model.model_name,
  };
}

function settle_pi_agent_run(
  queue: RuntimeEventQueue,
  terminal_assistant_message: AgentMessage | undefined,
  signal: AbortSignal,
  model_name: string,
) {
  const stop_reason = read_assistant_stop_reason(terminal_assistant_message);

  if (stop_reason === 'error') {
    queue.fail(create_pi_agent_stop_error(terminal_assistant_message));
    return;
  }

  // Pi reports a caller cancellation as a resolved assistant message. Preserve the runtime's
  // normal aborted status, but do not let an unexpected aborted response look like completion.
  if (stop_reason === 'aborted' && !signal.aborted) {
    queue.fail(create_pi_agent_stop_error(terminal_assistant_message));
    return;
  }

  if (stop_reason === 'stop' && is_empty_assistant_message(terminal_assistant_message)) {
    queue.fail(create_empty_model_response_error(model_name));
    return;
  }

  queue.close();
}

function is_empty_assistant_message(message: AgentMessage | undefined) {
  return message?.role === 'assistant' && message.content.length === 0;
}

function create_empty_model_response_error(model_name: string) {
  return new Error(
    `${model_name} returned an empty response: it stopped normally without any text or tool calls. Try a model better suited to this task.`,
  );
}

function read_assistant_stop_reason(message: AgentMessage | undefined) {
  return message?.role === 'assistant' ? message.stopReason : undefined;
}

function create_pi_agent_stop_error(message: AgentMessage | undefined) {
  if (message?.role === 'assistant' && message.errorMessage) {
    return new Error(`Model provider request ${message.stopReason}: ${message.errorMessage}`);
  }

  const stop_reason = read_assistant_stop_reason(message) ?? 'unknown';
  return new Error(`Model provider request stopped with ${stop_reason}`);
}

function pi_event_to_runtime_events(
  event: AgentEvent,
  model: RuntimeModelConfig,
  options: {
    can_emit_turn_message: boolean;
    can_emit_run_message: boolean;
    streamed_text: string;
  },
): RuntimeAgentEngineEvent[] {
  if (event.type === 'message_update') {
    const update = event.assistantMessageEvent;
    if (!options.can_emit_turn_message) return [];

    if (update.type === 'thinking_start') {
      return [
        create_progress_event(
          'pi.thinking_start',
          { content_index: update.contentIndex },
          model_event_metadata(model),
        ),
      ];
    }

    if (update.type === 'thinking_delta' && update.delta) {
      return [
        create_progress_event(
          'pi.thinking_delta',
          { content_index: update.contentIndex, delta: update.delta },
          model_event_metadata(model),
        ),
      ];
    }

    if (update.type === 'thinking_end') {
      return [
        create_progress_event(
          'pi.thinking_end',
          { content_index: update.contentIndex, content: update.content },
          model_event_metadata(model),
        ),
      ];
    }

    if (update.type !== 'text_delta' || !update.delta) return [];

    return [
      {
        type: 'message_delta',
        delta: update.delta,
        accumulated_text: options.streamed_text,
        content_index: update.contentIndex,
        metadata: {
          engine_name: 'pi',
          provider: get_pi_runtime_provider_name(model),
          model_provider: model.model_provider,
          model_proxy: model.model_proxy ?? model.model_provider,
          model: model.model_name,
        },
      },
    ];
  }

  if (event.type === 'tool_execution_start') {
    return [
      create_progress_event('pi.tool_execution_start', undefined, {
        tool_call_id: event.toolCallId,
        ...runtime_tool_event_metadata(event.toolName),
        args: event.args,
      }),
    ];
  }

  if (event.type === 'tool_execution_update') {
    return [
      create_progress_event('pi.tool_execution_update', undefined, {
        tool_call_id: event.toolCallId,
        ...runtime_tool_event_metadata(event.toolName),
        args: event.args,
        partial_result: event.partialResult,
      }),
    ];
  }

  if (event.type === 'tool_execution_end') return tool_end_events(event, model);

  if (event.type === 'agent_start' || event.type === 'turn_start') return [];

  if (event.type === 'turn_end') {
    const message = options.can_emit_turn_message
      ? (agent_message_to_runtime_message(event.message, model) ??
        streamed_text_to_runtime_message(options.streamed_text, model))
      : undefined;

    return message ? [{ type: 'message' as const, message }] : [];
  }

  if (event.type === 'message_end') {
    const message = options.can_emit_turn_message
      ? (agent_message_to_runtime_message(event.message, model) ??
        streamed_text_to_runtime_message(options.streamed_text, model))
      : undefined;

    return message ? [{ type: 'message', message }] : [];
  }

  if (event.type === 'agent_end') {
    const message = options.can_emit_run_message
      ? (latest_agent_message_to_runtime_message(event.messages, model) ??
        streamed_text_to_runtime_message(options.streamed_text, model))
      : undefined;

    return message ? [{ type: 'message' as const, message }] : [];
  }

  if (event.type === 'message_start') return [];

  return [];
}

function agent_message_to_runtime_message(
  message: AgentMessage,
  model: RuntimeModelConfig,
): RuntimeAgentMessage | undefined {
  if (message.role !== 'assistant') return undefined;
  return pi_assistant_message_to_runtime_message(message, model);
}

function latest_agent_message_to_runtime_message(
  messages: readonly AgentMessage[],
  model: RuntimeModelConfig,
): RuntimeAgentMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;

    const runtime_message = agent_message_to_runtime_message(message, model);
    if (runtime_message) return runtime_message;
  }

  return undefined;
}

function latest_agent_message(messages: readonly AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant') return message;
  }

  return undefined;
}

function collect_text_delta(event: AgentEvent, text_by_index: Map<number, string>) {
  if (event.type !== 'message_update') return;
  const update = event.assistantMessageEvent;
  if (update.type !== 'text_delta') return;

  text_by_index.set(
    update.contentIndex,
    `${text_by_index.get(update.contentIndex) ?? ''}${update.delta}`,
  );
}

function join_streamed_text(text_by_index: Map<number, string>) {
  return [...text_by_index.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text)
    .join('\n')
    .trim();
}

function runtime_tool_event_metadata(tool_name: string) {
  return { tool_name };
}

function traceable_pi_tool(tool: ReturnType<typeof runtime_tools_to_pi_tools>[number]) {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.executionMode === undefined ? {} : { executionMode: tool.executionMode }),
    has_prepare_arguments: typeof tool.prepareArguments === 'function',
    has_execute: typeof tool.execute === 'function',
  };
}

function create_traced_stream_fn(trace_context: {
  run_key: string;
  session_key?: string;
}): StreamFn {
  return (model, context, options) => {
    const stream_options = agent_run_stream_options(options);
    trace_agent_io('pi.llm.input', {
      ...trace_context,
      model,
      context,
      options: traceable_stream_options(stream_options),
    });

    return get_pi_models().streamSimple(model, context, {
      ...stream_options,
      onPayload: async (payload, payload_model) => {
        const shipped_payload = defer_tools_in_provider_payload(payload, payload_model);
        trace_agent_io('pi.llm.provider_payload', {
          ...trace_context,
          model: payload_model,
          payload: shipped_payload,
          ...(shipped_payload === payload || !is_agent_io_trace_on()
            ? {}
            : {
                tool_deferral: {
                  before: measure_tool_block(payload),
                  after: measure_tool_block(shipped_payload),
                },
              }),
        });

        const next_payload = await options?.onPayload?.(shipped_payload, payload_model);
        return next_payload === undefined ? shipped_payload : next_payload;
      },
      onResponse: async (response, response_model) => {
        trace_agent_io('pi.llm.provider_response', {
          ...trace_context,
          model: response_model,
          response: traceable_provider_response(response),
        });

        await options?.onResponse?.(response, response_model);
      },
    });
  };
}

function defer_tools_in_provider_payload(payload: unknown, model: Model<Api>) {
  const policy = read_tool_deferral_policy(process.env);
  if (!policy || !provider_loads_deferred_tools(model)) return payload;

  return defer_tools_in_anthropic_payload(payload, policy);
}

function agent_run_stream_options(
  options: ModelsSimpleStreamOptions | undefined,
): ModelsSimpleStreamOptions {
  const policy = require_model_use_case_policy('agent_run');
  const cache_retention =
    options?.cacheRetention && options.cacheRetention !== 'none'
      ? options.cacheRetention
      : policy.prompt_cache_retention;

  return {
    ...options,
    cacheRetention: cache_retention,
    maxRetries: options?.maxRetries ?? policy.maximum_retry_attempts,
    // Every tool call has a deadline. Without this one the model call has none, and a provider
    // stream that stops producing holds the run open with no end. pi-ai measures this as idleness
    // after the connection is up, so a slow answer that is still arriving keeps resetting it and
    // only true silence trips it. maxRetries then re-issues the request, which is why the limit
    // can sit well above the slowest healthy gap: a false trip costs one retry, not the run.
    ...(policy.stream_idle_timeout_ms === undefined
      ? {}
      : { timeoutMs: options?.timeoutMs ?? policy.stream_idle_timeout_ms }),
  };
}

function traceable_stream_options(options: ModelsSimpleStreamOptions | undefined) {
  if (!options) return undefined;

  return {
    signal: options.signal ? { aborted: options.signal.aborted } : undefined,
    reasoning: options.reasoning,
    thinkingBudgets: options.thinkingBudgets,
    transport: options.transport,
    cacheRetention: options.cacheRetention,
    sessionId: options.sessionId,
    hasApiKey: typeof options.apiKey === 'string' && options.apiKey.length > 0,
    hasOnPayload: typeof options.onPayload === 'function',
    hasOnResponse: typeof options.onResponse === 'function',
    headerNames: options.headers ? Object.keys(options.headers) : undefined,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    maxRetryDelayMs: options.maxRetryDelayMs,
    metadata: options.metadata,
  };
}

function traceable_provider_response(response: ProviderResponse) {
  return {
    status: response.status,
    headers: response.headers,
  };
}

// A trailing user message is the prompt. A transcript that ends in tool results is a run being
// continued instead, and pi continues that from the whole history — so taking the latest user
// message from anywhere would drop every message after it, which for a continued run is the held
// turn and its results, exactly the part the continuation exists to build on.
//
// A transcript ending in an assistant message is neither: pi refuses to continue from one. That
// case keeps the older behaviour — rewind to the last user turn — because a rewind is what it has
// always done and a hard failure would be a new one.
function split_prompt_from_history(messages: RuntimeAgentEngineInput['messages']) {
  const last_index = messages.length - 1;
  const last_role = messages[last_index]?.role;
  if (last_role === 'user') {
    return { history: messages.slice(0, last_index), prompt: messages[last_index] };
  }
  if (last_role === 'tool') return { history: messages, prompt: undefined };

  const prompt_index = find_latest_user_message_index(messages);
  if (prompt_index === -1) return { history: messages, prompt: undefined };

  return {
    history: messages.slice(0, prompt_index),
    prompt: messages[prompt_index],
  };
}

function find_latest_user_message_index(messages: RuntimeAgentEngineInput['messages']) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index;
  }

  return -1;
}

function get_pi_thinking_level(
  reasoning_level: RuntimeModelConfig['reasoning_level'],
): ModelThinkingLevel {
  return reasoning_level ?? require_model_use_case_policy('agent_run').reasoning_level;
}

function describe_runtime_model(model: RuntimeModelConfig) {
  const pi_model = describe_pi_model(model);
  if (pi_model.model.includes('/')) return pi_model.model;
  return `${get_pi_runtime_provider_name(model)}/${pi_model.model}`;
}

function create_event_queue<T>() {
  const items: T[] = [];
  const waiters: Array<() => void> = [];
  let done = false;
  let error: unknown;

  function notify() {
    const pending = waiters.splice(0, waiters.length);
    for (const waiter of pending) waiter();
  }

  return {
    push(item: T) {
      items.push(item);
      notify();
    },
    close() {
      done = true;
      notify();
    },
    fail(cause: unknown) {
      error = cause;
      done = true;
      notify();
    },
    async *[Symbol.asyncIterator]() {
      while (!done || items.length > 0) {
        while (items.length > 0) {
          const item = items.shift();
          if (item !== undefined) yield item;
        }

        if (!done) await new Promise<void>((resolve) => waiters.push(resolve));
      }

      if (error) throw error;
    },
  };
}
