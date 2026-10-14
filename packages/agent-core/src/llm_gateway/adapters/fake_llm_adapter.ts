import type {
  LlmGatewayAdapter,
  LlmResolvedRequest,
  LlmStreamEvent,
  LlmTextResult,
} from '@agent-core/llm_gateway/gateway_types';

export type FakeLlmAdapterResponse =
  | string
  | ((input: LlmResolvedRequest) => string | Promise<string>);

export function create_fake_llm_adapter(response: FakeLlmAdapterResponse): LlmGatewayAdapter {
  return {
    async generate_text(input) {
      return fake_text_result(input, await resolve_response(response, input));
    },
    async *stream(input): AsyncIterable<LlmStreamEvent> {
      const text = await resolve_response(response, input);
      yield {
        type: 'text_delta',
        delta: text,
        accumulated_text: text,
        metadata: {
          provider: input.model.model_proxy,
          model_provider: input.model.model_provider,
          model_proxy: input.model.model_proxy,
          model: input.model.model_name,
          use_case: input.use_case,
        },
      };
      yield {
        type: 'message',
        message: fake_text_result(input, text).message,
        metadata: {
          provider: input.model.model_proxy,
          model_provider: input.model.model_provider,
          model_proxy: input.model.model_proxy,
          model: input.model.model_name,
          use_case: input.use_case,
        },
      };
    },
  };
}

async function resolve_response(response: FakeLlmAdapterResponse, input: LlmResolvedRequest) {
  if (typeof response === 'function') return response(input);
  return response;
}

function fake_text_result(input: LlmResolvedRequest, text: string): LlmTextResult {
  return {
    text,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      metadata: {
        provider: input.model.model_proxy,
        model_provider: input.model.model_provider,
        model_proxy: input.model.model_proxy,
        model: input.model.model_name,
        fake: true,
      },
    },
    model: {
      model_provider: input.model.model_provider,
      model_proxy: input.model.model_proxy,
      model_name: input.model.model_name,
    },
    metadata: { fake: true },
  };
}
