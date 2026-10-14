import {
  runtime_message_content_to_pi_user_content,
  runtime_message_content_to_text,
} from '@agent-core/engines/pi/pi_messages';
import { get_pi_provider_name } from '@agent-core/engines/pi/pi_model';
import { get_pi_models } from '@agent-core/engines/pi/pi_models';
import type {
  LlmGatewayAdapter,
  LlmResolvedRequest,
  LlmStreamEvent,
  LlmTextResult,
  LlmUsage,
} from '@agent-core/llm_gateway/gateway_types';
import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import { require_model_use_case_policy, validate_model_tool_name } from '@coworker/shared';
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type Models,
  type ModelsSimpleStreamOptions,
  type Message as PiMessage,
  type Tool,
  Type,
  type Usage,
  type UserMessage,
} from '@earendil-works/pi-ai';

export function create_pi_ai_adapter(models: Models = get_pi_models()): LlmGatewayAdapter {
  return {
    async generate_text(input) {
      const model = require_pi_model(models, input);
      const message = await models.completeSimple(
        model,
        request_to_pi_context(input),
        stream_options(input),
      );

      return pi_message_to_text_result(message, input);
    },
    async *stream(input) {
      const model = require_pi_model(models, input);
      const stream = models.streamSimple(
        model,
        request_to_pi_context(input),
        stream_options(input),
      );
      let accumulated_text = '';

      for await (const event of stream) {
        for (const mapped_event of pi_event_to_gateway_events(event, input, accumulated_text)) {
          if (mapped_event.type === 'text_delta') accumulated_text = mapped_event.accumulated_text;
          yield mapped_event;
        }
      }
    },
  };
}

function require_pi_model(models: Models, input: LlmResolvedRequest): Model<Api> {
  const provider = get_pi_provider_name(input.model.model_proxy);
  const model = models.getModel(provider, input.model.model_name);
  if (!model) {
    throw new Error(`Pi model not found for ${provider}/${input.model.model_name}`);
  }
  return model;
}

function request_to_pi_context(input: LlmResolvedRequest): Context {
  return {
    ...(input.system_prompt === undefined ? {} : { systemPrompt: input.system_prompt }),
    messages: input.messages.flatMap(runtime_message_to_pi_message),
    ...(input.tools === undefined ? {} : { tools: input.tools.map(runtime_tool_to_pi_tool) }),
  };
}

function stream_options(input: LlmResolvedRequest): ModelsSimpleStreamOptions {
  const reasoning = pi_reasoning_level(input);
  const policy = require_model_use_case_policy(input.use_case);

  return {
    apiKey: input.model.api_key,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(input.model.temperature === undefined ? {} : { temperature: input.model.temperature }),
    ...(input.model.max_output_tokens === undefined
      ? {}
      : { maxTokens: input.model.max_output_tokens }),
    ...(input.session_id === undefined && input.run_id === undefined
      ? {}
      : { sessionId: input.session_id ?? input.run_id }),
    cacheRetention: policy.prompt_cache_retention,
    maxRetries: policy.maximum_retry_attempts,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

function runtime_message_to_pi_message(message: RuntimeAgentMessage): PiMessage[] {
  const timestamp = Number(message.metadata?.timestamp ?? Date.now());

  if (message.role === 'assistant') {
    return [
      {
        role: 'assistant',
        content: [{ type: 'text', text: runtime_message_content_to_text(message.content) }],
        api: String(message.metadata?.api ?? 'runtime'),
        provider: String(message.metadata?.provider ?? 'runtime'),
        model: String(message.metadata?.model ?? 'runtime'),
        usage: empty_usage(),
        stopReason: 'stop',
        timestamp,
      },
    ];
  }

  return [
    {
      role: 'user',
      content: runtime_message_content_to_pi_user_content(message.content),
      timestamp,
    } satisfies UserMessage,
  ];
}

function runtime_tool_to_pi_tool(tool: NonNullable<LlmResolvedRequest['tools']>[number]): Tool {
  return {
    name: validate_model_tool_name(tool.tool_name),
    description: tool.description,
    parameters: (tool.input_schema ?? Type.Object({})) as never,
  };
}

function pi_message_to_text_result(
  message: AssistantMessage,
  input: LlmResolvedRequest,
): LlmTextResult {
  const text = assistant_message_text(message);
  return {
    text,
    message: {
      role: 'assistant',
      content: text ? [{ type: 'text', text }] : [],
      metadata: {
        provider: input.model.model_proxy,
        model_provider: input.model.model_provider,
        model_proxy: input.model.model_proxy,
        model: input.model.model_name,
        response_model: message.responseModel ?? message.model,
        stop_reason: message.stopReason,
        usage: message.usage,
      },
    },
    model: {
      model_provider: input.model.model_provider,
      model_proxy: input.model.model_proxy,
      model_name: input.model.model_name,
      response_model: message.responseModel ?? message.model,
    },
    usage: pi_usage_to_llm_usage(message.usage),
    metadata: {
      stop_reason: message.stopReason,
      ...(message.errorMessage === undefined ? {} : { error_message: message.errorMessage }),
      ...(message.responseId === undefined ? {} : { response_id: message.responseId }),
    },
  };
}

function pi_event_to_gateway_events(
  event: AssistantMessageEvent,
  input: LlmResolvedRequest,
  accumulated_text_before_event: string,
): LlmStreamEvent[] {
  if (event.type === 'text_delta') {
    const accumulated_text = `${accumulated_text_before_event}${event.delta}`;
    return [
      {
        type: 'text_delta',
        delta: event.delta,
        accumulated_text,
        content_index: event.contentIndex,
        metadata: event_metadata(input),
      },
    ];
  }

  if (event.type === 'done') {
    return [
      {
        type: 'message',
        message: pi_message_to_text_result(event.message, input).message,
        metadata: event_metadata(input),
      },
    ];
  }

  if (event.type === 'error') {
    return [
      {
        type: 'message',
        message: pi_message_to_text_result(event.error, input).message,
        metadata: { ...event_metadata(input), error: event.error.errorMessage },
      },
    ];
  }

  return [];
}

function event_metadata(input: LlmResolvedRequest) {
  return {
    provider: input.model.model_proxy,
    model_provider: input.model.model_provider,
    model_proxy: input.model.model_proxy,
    model: input.model.model_name,
    use_case: input.use_case,
  };
}

function assistant_message_text(message: AssistantMessage) {
  return message.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim();
}

function pi_usage_to_llm_usage(usage: Usage): LlmUsage {
  return {
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_read_tokens: usage.cacheRead,
    cache_write_tokens: usage.cacheWrite,
    total_tokens: usage.totalTokens,
    cost_microcents: Math.round(usage.cost.total * 100_000_000),
    provider_usage: usage,
  };
}

function empty_usage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function pi_reasoning_level(input: LlmResolvedRequest) {
  const reasoning_level = input.model.reasoning_level;
  return reasoning_level && reasoning_level !== 'off' ? reasoning_level : undefined;
}
