import type { RuntimeAgentMessage } from '@agent-core/messages';
import type {
  RuntimeModelConfig,
  RuntimeReasoningLevel,
} from '@agent-core/models/runtime_model_config';
import type { RuntimeToolDefinition } from '@agent-core/tools';
import type { LanguageModelUseCase, ModelAccessRules } from '@coworker/shared';

export type LlmUseCase = LanguageModelUseCase;

type LlmResponseFormat = { type: 'text' } | { type: 'json_object'; schema_name?: string };

type LlmModelRequest = {
  model_proxy?: string | null | undefined;
  model_name?: string | null | undefined;
  reasoning_level?: RuntimeReasoningLevel | null | undefined;
  temperature?: number | null | undefined;
  max_output_tokens?: number | null | undefined;
};

export type LlmModelResolutionInput = LlmModelRequest & {
  use_case: LlmUseCase;
  model_access?: ModelAccessRules | undefined;
};

export type LlmResolvedModel = RuntimeModelConfig & {
  model_provider: string;
  model_proxy: string;
  model_name: string;
  api_key: string;
  credential_env_name: string;
};

export type LlmRequest = {
  use_case: LlmUseCase;
  workspace_id?: string;
  agent_id?: string;
  session_id?: string;
  run_id?: string;
  system_prompt?: string;
  messages: RuntimeAgentMessage[];
  model?: LlmModelRequest;
  tools?: RuntimeToolDefinition[];
  response_format?: LlmResponseFormat;
  temperature?: number;
  max_output_tokens?: number;
  reasoning_level?: RuntimeReasoningLevel;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
};

export type LlmResolvedRequest = Omit<LlmRequest, 'model'> & {
  model: LlmResolvedModel;
};

export type LlmTextResult = {
  text: string;
  message: RuntimeAgentMessage;
  model: {
    model_provider: string;
    model_proxy: string;
    model_name: string;
    response_model?: string;
  };
  usage?: LlmUsage;
  metadata: Record<string, unknown>;
};

export type LlmObjectRequest<T> = Omit<LlmRequest, 'response_format'> & {
  response_format: Extract<LlmResponseFormat, { type: 'json_object' }>;
  parse?: (value: unknown) => T;
};

export type LlmObjectResult<T> = {
  object: T;
  text: string;
  result: LlmTextResult;
};

export type LlmStreamEvent =
  | {
      type: 'text_delta';
      delta: string;
      accumulated_text: string;
      content_index?: number;
      metadata: Record<string, unknown>;
    }
  | {
      type: 'message';
      message: RuntimeAgentMessage;
      metadata: Record<string, unknown>;
    }
  | {
      type: 'provider_payload';
      payload: unknown;
      metadata: Record<string, unknown>;
    }
  | {
      type: 'provider_response';
      response: unknown;
      metadata: Record<string, unknown>;
    };

export type LlmUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_microcents: number;
  provider_usage?: unknown;
};

export type LlmGatewayAdapter = {
  generate_text(input: LlmResolvedRequest): Promise<LlmTextResult>;
  stream(input: LlmResolvedRequest): AsyncIterable<LlmStreamEvent>;
};

export type LlmGateway = {
  resolve_model(input: LlmModelResolutionInput): LlmResolvedModel;
  generate_text(input: LlmRequest): Promise<LlmTextResult>;
  generate_object<T>(input: LlmObjectRequest<T>): Promise<LlmObjectResult<T>>;
  stream(input: LlmRequest): AsyncIterable<LlmStreamEvent>;
};
