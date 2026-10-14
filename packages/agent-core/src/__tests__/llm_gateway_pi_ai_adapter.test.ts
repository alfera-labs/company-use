import type { LlmResolvedRequest } from '@agent-core/llm_gateway';
import { create_pi_ai_adapter } from '@agent-core/llm_gateway/adapters/pi_ai_adapter';
import type { Models } from '@earendil-works/pi-ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pi_ai = vi.hoisted(() => ({
  complete_simple: vi.fn(),
  get_model: vi.fn(),
  stream_simple: vi.fn(),
}));

describe('Pi AI LLM adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pi_ai.get_model.mockImplementation((provider: string, model: string) => ({ provider, model }));
    pi_ai.complete_simple.mockResolvedValue(assistant_message('Gateway ready'));
    pi_ai.stream_simple.mockImplementation(async function* () {
      yield { type: 'text_delta', delta: 'Gate', contentIndex: 0 };
      yield { type: 'text_delta', delta: 'way', contentIndex: 0 };
      yield { type: 'done', message: assistant_message('Gateway') };
    });
  });

  it('maps gateway text requests into Pi complete calls', async () => {
    const adapter = create_test_adapter();
    const result = await adapter.generate_text(resolved_request());

    expect(pi_ai.get_model).toHaveBeenCalledWith('openai', 'gpt-test');
    expect(pi_ai.complete_simple).toHaveBeenCalledWith(
      { provider: 'openai', model: 'gpt-test' },
      {
        systemPrompt: expect.stringContaining('Be concise.'),
        messages: [{ role: 'user', content: 'Summarize the run.', timestamp: expect.any(Number) }],
      },
      expect.objectContaining({ apiKey: 'test-key', maxTokens: 64 }),
    );
    expect(pi_ai.complete_simple.mock.calls[0]?.[2]).toMatchObject({
      cacheRetention: 'short',
    });
    expect(result).toMatchObject({
      text: 'Gateway ready',
      model: {
        model_provider: 'openai',
        model_proxy: 'openai_direct',
        model_name: 'gpt-test',
        response_model: 'gpt-test-response',
      },
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        total_tokens: 14,
      },
    });
  });

  it('preserves user image content through the canonical pi converter', async () => {
    const adapter = create_test_adapter();
    await adapter.generate_text(
      resolved_request({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this image?' },
              { type: 'image', data: 'base64-image-data', mime_type: 'image/png' },
            ],
          },
        ],
      }),
    );

    expect(pi_ai.complete_simple.mock.calls[0]?.[1]).toMatchObject({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image', data: 'base64-image-data', mimeType: 'image/png' },
          ],
        },
      ],
    });
  });

  it('maps Pi stream events into gateway stream events', async () => {
    const adapter = create_test_adapter();
    const events = [];

    for await (const event of adapter.stream(resolved_request())) events.push(event);

    expect(events).toMatchObject([
      { type: 'text_delta', delta: 'Gate', accumulated_text: 'Gate' },
      { type: 'text_delta', delta: 'way', accumulated_text: 'Gateway' },
      { type: 'message', message: { role: 'assistant' } },
    ]);
  });

  it('requests long prompt-cache retention for agent-run requests', async () => {
    const adapter = create_test_adapter();

    await adapter.generate_text(
      resolved_request({
        use_case: 'agent_run',
        session_id: 'session_test',
        run_id: 'run_test',
        model: {
          model_provider: 'anthropic',
          model_proxy: 'anthropic_direct',
          model_name: 'claude-sonnet-4-5',
          api_key: 'test-anthropic-key',
          credential_env_name: 'ANTHROPIC_API_KEY',
          reasoning_level: 'medium',
        },
      }),
    );

    expect(pi_ai.get_model).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-5');
    expect(pi_ai.complete_simple.mock.calls[0]?.[2]).toMatchObject({
      apiKey: 'test-anthropic-key',
      cacheRetention: 'long',
      sessionId: 'session_test',
    });
  });

  it('keeps what the provider said when the call fails', async () => {
    pi_ai.complete_simple.mockResolvedValue({
      ...assistant_message(''),
      content: [],
      stopReason: 'error',
      errorMessage: '400 `temperature` is deprecated for this model.',
    });

    const result = await create_test_adapter().generate_text(resolved_request());

    expect(result.text).toBe('');
    expect(result.metadata).toMatchObject({
      stop_reason: 'error',
      error_message: '400 `temperature` is deprecated for this model.',
    });
  });
});

function create_test_adapter() {
  return create_pi_ai_adapter({
    getModel: pi_ai.get_model,
    completeSimple: pi_ai.complete_simple,
    streamSimple: pi_ai.stream_simple,
  } as unknown as Models);
}

function resolved_request(overrides: Partial<LlmResolvedRequest> = {}): LlmResolvedRequest {
  const request: LlmResolvedRequest = {
    use_case: 'session_title',
    system_prompt: 'Be concise.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Summarize the run.' }] }],
    response_format: { type: 'json_object', schema_name: 'session_title' },
    model: {
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      model_name: 'gpt-test',
      api_key: 'test-key',
      credential_env_name: 'OPENAI_API_KEY',
      reasoning_level: 'off',
      max_output_tokens: 64,
    },
  };

  return {
    ...request,
    ...overrides,
    model: {
      ...request.model,
      ...overrides.model,
    },
    messages: overrides.messages ?? request.messages,
  };
}

function assistant_message(text: string) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'responses',
    provider: 'openai',
    model: 'gpt-test',
    responseModel: 'gpt-test-response',
    responseId: 'resp_test',
    stopReason: 'stop',
    usage: {
      input: 10,
      output: 4,
      cacheRead: 2,
      cacheWrite: 0,
      totalTokens: 14,
      cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0, total: 3.5 },
    },
    timestamp: Date.now(),
  };
}
