import { create_pi_ai_adapter } from '@agent-core/llm_gateway/adapters/pi_ai_adapter';
import type {
  LlmGateway,
  LlmGatewayAdapter,
  LlmModelResolutionInput,
  LlmObjectRequest,
  LlmObjectResult,
  LlmRequest,
  LlmResolvedRequest,
  LlmTextResult,
} from '@agent-core/llm_gateway/gateway_types';
import { type LlmEnvironment, resolve_llm_model } from '@agent-core/llm_gateway/model_resolver';
import { make_messages_well_formed } from '@agent-core/messages/message_integrity';
import { format_error_message, require_model_use_case_policy } from '@coworker/shared';

export type CreateLlmGatewayOptions = {
  adapter?: LlmGatewayAdapter;
  environment?: LlmEnvironment;
};

export function create_llm_gateway(options: CreateLlmGatewayOptions = {}): LlmGateway {
  const adapter = options.adapter ?? create_pi_ai_adapter();
  const environment = options.environment;

  return {
    resolve_model(input) {
      return resolve_llm_model(input, environment);
    },
    async generate_text(input) {
      assert_llm_request_allowed(input, 'generate_text');
      return adapter.generate_text(resolve_request(input, environment));
    },
    async generate_object(input) {
      assert_llm_request_allowed(input, 'generate_object');
      return generate_object(adapter, resolve_request(input, environment), input);
    },
    stream(input) {
      assert_llm_request_allowed(input, 'stream');
      return adapter.stream(resolve_request(input, environment));
    },
  };
}

function assert_llm_request_allowed(
  input: LlmRequest,
  operation: 'generate_text' | 'generate_object' | 'stream',
) {
  const policy = require_model_use_case_policy(input.use_case);

  if (operation === 'stream' && !policy.stream) {
    throw new Error(`LLM use case ${input.use_case} does not allow streaming.`);
  }

  if (!policy.tools && input.tools?.length) {
    throw new Error(`LLM use case ${input.use_case} does not allow tools.`);
  }

  if (!policy.images && request_has_images(input)) {
    throw new Error(`LLM use case ${input.use_case} does not allow images.`);
  }
}

function request_has_images(input: LlmRequest) {
  return input.messages.some((message) => message.content.some((part) => part.type === 'image'));
}

function resolve_request(
  input: LlmRequest,
  environment: LlmEnvironment | undefined,
): LlmResolvedRequest {
  return {
    ...input,
    messages: make_messages_well_formed(input.messages),
    model: resolve_llm_model(model_resolution_input(input), environment),
  };
}

function model_resolution_input(input: LlmRequest): LlmModelResolutionInput {
  return {
    use_case: input.use_case,
    model_proxy: input.model?.model_proxy,
    model_name: input.model?.model_name,
    reasoning_level: input.reasoning_level ?? input.model?.reasoning_level,
    temperature: input.temperature ?? input.model?.temperature,
    max_output_tokens: input.max_output_tokens ?? input.model?.max_output_tokens,
  };
}

async function generate_object<T>(
  adapter: LlmGatewayAdapter,
  request: LlmResolvedRequest,
  input: LlmObjectRequest<T>,
): Promise<LlmObjectResult<T>> {
  const result = await adapter.generate_text(request);
  const parsed = parse_json_response(result);
  const object = input.parse ? input.parse(parsed) : (parsed as T);

  return {
    object,
    text: result.text,
    result,
  };
}

function parse_json_response(result: LlmTextResult) {
  try {
    return JSON.parse(strip_json_fence(result.text));
  } catch (error) {
    const provider_error = result.metadata.error_message;
    if (typeof provider_error === 'string') throw new Error(`LLM call failed: ${provider_error}`);
    const message = format_error_message(error);
    throw new Error(`LLM response was not valid JSON: ${message}`);
  }
}

function strip_json_fence(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;

  return trimmed
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
}
