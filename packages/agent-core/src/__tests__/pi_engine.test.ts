import {
  create_pi_engine,
  describe_pi_model,
  get_pi_model,
  get_pi_provider_name,
  get_pi_runtime_provider_name,
  list_pi_model_ids,
  pi_assistant_message_to_runtime_message,
  runtime_message_content_to_text,
  runtime_message_to_pi_message,
  runtime_messages_to_pi_messages,
  runtime_model_credential_env_names,
  runtime_tool_result_to_agent_tool_result,
  runtime_tools_to_pi_tools,
} from '@agent-core/engines/pi';
import type { RuntimeAgentEngineEvent, RuntimeAgentEngineInput } from '@agent-core/runs';
import { model_visible_tool_text_limit_chars } from '@coworker/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pi_ai = vi.hoisted(() => ({
  stream_simple: vi.fn(),
}));

vi.mock('@agent-core/engines/pi/pi_models', async (import_original) => {
  const original = await import_original<typeof import('@agent-core/engines/pi/pi_models')>();
  const models = original.get_pi_models();
  const test_models = new Proxy(models, {
    get(target, property) {
      if (property === 'streamSimple') return pi_ai.stream_simple;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    ...original,
    get_pi_models: () => test_models,
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('create_pi_engine', () => {
  it('exposes the agent-core engine contract with real Pi model lookup', () => {
    expect(get_pi_model({ model_provider: 'openai', model_name: 'gpt-5.5' })).toMatchObject({
      provider: 'openai',
      id: 'gpt-5.5',
      api: 'openai-responses',
    });
  });

  it('fails when the configured model is not a Pi model', async () => {
    const engine = create_pi_engine();

    await expect(collect_events(engine.run(create_test_engine_input('local')))).rejects.toThrow(
      'Pi model not found for local/gpt-5.5',
    );
  });

  it('fails when the configured provider has no API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('PI_OPENAI_API_KEY', '');
    const engine = create_pi_engine();

    await expect(collect_events(engine.run(create_test_engine_input('openai')))).rejects.toThrow(
      'No API key configured for openai',
    );
  });

  it('completes when Pi returns a normal assistant response', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    pi_ai.stream_simple.mockReturnValue(create_assistant_stream({ stopReason: 'stop' }));
    const engine = create_pi_engine();

    await expect(
      collect_events(engine.run(create_test_engine_input('openai'))),
    ).resolves.toMatchObject([{ type: 'message', message: { role: 'assistant' } }]);
  });

  it('uses the Vercel Gateway credential for a proxied Anthropic model', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('VERCEL_AI_GATEWAY_API_KEY', 'test-gateway-key');
    pi_ai.stream_simple.mockReturnValue(create_assistant_stream({ stopReason: 'stop' }));
    const engine = create_pi_engine();
    const input = create_test_engine_input('anthropic');

    await collect_events(
      engine.run({
        ...input,
        model: {
          ...input.model,
          model_provider: 'anthropic',
          model_proxy: 'vercel_ai_gateway',
          model_name: 'anthropic/claude-opus-4.8',
        },
      }),
    );

    expect(pi_ai.stream_simple).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'vercel-ai-gateway',
        id: 'anthropic/claude-opus-4.8',
      }),
      expect.any(Object),
      expect.objectContaining({ apiKey: 'test-gateway-key' }),
    );
  });

  it('rejects when Pi returns a terminal provider error', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    pi_ai.stream_simple.mockReturnValue(
      create_assistant_stream({
        stopReason: 'error',
        errorMessage: 'The provider rejected the request.',
      }),
    );
    const engine = create_pi_engine();

    await expect(collect_events(engine.run(create_test_engine_input('openai')))).rejects.toThrow(
      'Model provider request error: The provider rejected the request.',
    );
  });

  it('names the model when it stops cleanly having said nothing', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    pi_ai.stream_simple.mockReturnValue(
      create_assistant_stream({ stopReason: 'stop', content: [] }),
    );
    const engine = create_pi_engine();

    await expect(collect_events(engine.run(create_test_engine_input('openai')))).rejects.toThrow(
      'openai/gpt-5.5 returned an empty response: it stopped normally without any text or tool calls. Try a model better suited to this task.',
    );
  });

  it('does not treat an unexpected aborted response as completion', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    pi_ai.stream_simple.mockReturnValue(
      create_assistant_stream({
        stopReason: 'aborted',
        errorMessage: 'The provider stopped the request.',
      }),
    );
    const engine = create_pi_engine();

    await expect(collect_events(engine.run(create_test_engine_input('openai')))).rejects.toThrow(
      'Model provider request aborted: The provider stopped the request.',
    );
  });

  it('preserves caller cancellation when Pi returns an aborted response', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    const abort_controller = new AbortController();
    pi_ai.stream_simple.mockImplementation(() => {
      abort_controller.abort();
      return create_assistant_stream({ stopReason: 'aborted' });
    });
    const engine = create_pi_engine();

    await expect(
      collect_events(
        engine.run({ ...create_test_engine_input('openai'), signal: abort_controller.signal }),
      ),
    ).resolves.toMatchObject([{ type: 'message' }]);
  });
});

describe('pi model helpers', () => {
  it('describes runtime-owned model config for the Pi boundary', () => {
    expect(
      describe_pi_model({
        model_provider: 'anthropic',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'anthropic/claude-sonnet-5',
        reasoning_level: 'medium',
        max_output_tokens: 1200,
      }),
    ).toEqual({
      model_provider: 'anthropic',
      model: 'anthropic/claude-sonnet-5',
      model_proxy: 'vercel_ai_gateway',
      parameters: {
        reasoningLevel: 'medium',
        maxOutputTokens: 1200,
      },
    });

    expect(get_pi_provider_name('vercel_ai_gateway')).toBe('vercel-ai-gateway');
    expect(
      get_pi_runtime_provider_name({
        model_provider: 'anthropic',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'anthropic/claude-sonnet-5',
      }),
    ).toBe('vercel-ai-gateway');
    expect(list_pi_model_ids('vercel_ai_gateway')).toContain('zai/glm-5.2');
    expect(
      runtime_model_credential_env_names({ model_provider: 'openai', model_name: 'gpt-5' }),
    ).toContain('OPENAI_API_KEY');
  });

  it('resolves current Anthropic models from the Pi registry', () => {
    expect(
      get_pi_model({ model_provider: 'anthropic', model_name: 'claude-fable-5' }),
    ).toMatchObject({
      provider: 'anthropic',
      id: 'claude-fable-5',
    });
    expect(
      describe_pi_model({ model_provider: 'anthropic', model_name: 'claude-sonnet-5' }),
    ).toMatchObject({
      model_provider: 'anthropic',
      model_proxy: 'anthropic_direct',
      model: 'claude-sonnet-5',
    });
  });

  it('resolves an Anthropic model through the Vercel AI Gateway proxy', () => {
    expect(
      get_pi_model({
        model_provider: 'anthropic',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'anthropic/claude-opus-4.8',
      }),
    ).toMatchObject({
      provider: 'vercel-ai-gateway',
      id: 'anthropic/claude-opus-4.8',
    });
  });
});

describe('pi message helpers', () => {
  it('serializes mixed runtime message content for the model boundary', () => {
    expect(
      runtime_message_content_to_text([
        { type: 'text', text: 'Use the tool.' },
        {
          type: 'tool_result',
          tool_call_id: 'tool_1',
          tool_name: 'search',
          result: { ok: true, content_json: { found: true } },
        },
      ]),
    ).toBe('Use the tool.\n{"found":true}');
  });

  it('preserves image input at the Pi message boundary', () => {
    expect(
      runtime_message_to_pi_message({
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', data: 'base64-image-data', mime_type: 'image/png' },
        ],
      }),
    ).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image', data: 'base64-image-data', mimeType: 'image/png' },
      ],
    });
  });

  it('passes attached file and document text into the Pi prompt boundary', () => {
    expect(
      runtime_message_to_pi_message({
        role: 'user',
        content: [
          { type: 'text', text: 'Review this doc.' },
          {
            type: 'file',
            name: 'brief.md',
            mime_type: 'text/markdown',
            text: '# Launch\nShip the runtime.',
          },
        ],
      }),
    ).toMatchObject({
      role: 'user',
      content:
        'Review this doc.\n[file] name=brief.md mime_type=text/markdown # Launch\nShip the runtime.',
    });
  });

  it('replays persisted tool results as native pi tool-result messages', () => {
    expect(
      runtime_message_to_pi_message({
        role: 'tool',
        tool_call_id: 'call_provider_1',
        name: 'runtime-search_tools-1',
        content: [
          {
            type: 'tool_result',
            tool_call_id: 'call_provider_1',
            tool_name: 'runtime-search_tools-1',
            result: {
              ok: true,
              content_json: { tools: [{ node_key: 'google_drive-search-1' }] },
            },
          },
        ],
      }),
    ).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call_provider_1',
      toolName: 'runtime-search_tools-1',
      isError: false,
      content: [{ type: 'text', text: '{"tools":[{"node_key":"google_drive-search-1"}]}' }],
    });
  });

  it('bounds an oversized replayed tool result before it reaches the provider', () => {
    const message = runtime_message_to_pi_message({
      role: 'tool',
      tool_call_id: 'call_read_1',
      name: 'pi-read-1',
      content: [
        {
          type: 'tool_result',
          tool_call_id: 'call_read_1',
          tool_name: 'pi-read-1',
          result: {
            ok: true,
            content_text: `HEAD_MARKER${'x'.repeat(400_000)}TAIL_MARKER`,
          },
        },
      ],
    });

    const first_content = message?.role === 'toolResult' ? message.content[0] : undefined;
    const text =
      typeof first_content === 'object' && first_content !== null && 'text' in first_content
        ? String(first_content.text)
        : '';
    expect(text.length).toBeLessThan(model_visible_tool_text_limit_chars + 300);
    expect(text).toContain('HEAD_MARKER');
    expect(text).toContain('TAIL_MARKER');
    expect(text).toContain('characters omitted from the middle');
  });

  it('keeps a failed tool result an error, with its message intact', () => {
    expect(
      runtime_message_to_pi_message({
        role: 'tool',
        tool_call_id: 'call_fail_1',
        name: 'runtime-execute_tool-1',
        content: [
          {
            type: 'tool_result',
            tool_call_id: 'call_fail_1',
            tool_name: 'runtime-execute_tool-1',
            result: {
              ok: false,
              error_code: 'write_verification_failed',
              error_message: 'Google Docs did not contain the requested text after the write.',
            },
          },
        ],
      }),
    ).toMatchObject({
      role: 'toolResult',
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Google Docs did not contain the requested text after the write.',
        },
      ],
    });
  });

  it('forwards a tool-result IMAGE (e.g. a browser screenshot) as a native pi image block', () => {
    expect(
      runtime_message_to_pi_message({
        role: 'tool',
        tool_call_id: 'call_shot_1',
        name: 'browser',
        content: [
          {
            type: 'tool_result',
            tool_call_id: 'call_shot_1',
            tool_name: 'browser',
            result: {
              ok: true,
              content: [
                { type: 'text', text: 'Screenshot saved to /work/shot.png\n[1] @e1 link "Docs"' },
                { type: 'image', data: 'base64-png-bytes', mime_type: 'image/png' },
              ],
              content_text: 'Screenshot saved to /work/shot.png',
            },
          },
        ],
      }),
    ).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call_shot_1',
      toolName: 'browser',
      isError: false,
      content: [
        { type: 'text', text: 'Screenshot saved to /work/shot.png\n[1] @e1 link "Docs"' },
        { type: 'image', data: 'base64-png-bytes', mimeType: 'image/png' },
      ],
    });
  });

  it('replays persisted assistant tool calls as native pi tool-call blocks', () => {
    expect(
      runtime_message_to_pi_message({
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            id: 'call_provider_1',
            name: 'runtime-search_tools-1',
            arguments: { query: 'drive' },
            thought_signature: 'sig_thought',
          },
        ],
      }),
    ).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'call_provider_1',
          name: 'runtime-search_tools-1',
          arguments: { query: 'drive' },
          thoughtSignature: 'sig_thought',
        },
      ],
    });
  });

  it('round-trips tool calls and results as native pi blocks, never marker text', () => {
    const pi_messages = runtime_messages_to_pi_messages([
      { role: 'user', content: [{ type: 'text', text: 'Search drive.' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_call', id: 'call_1', name: 'search', arguments: { query: 'drive' } },
        ],
        metadata: { api: 'openai-responses', provider: 'openai', model: 'gpt-5.5' },
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        name: 'search',
        content: [
          {
            type: 'tool_result',
            tool_call_id: 'call_1',
            tool_name: 'search',
            result: { ok: false, error_code: 'not_found', error_message: 'No results.' },
          },
        ],
      },
    ]);

    expect(pi_messages).toHaveLength(3);
    expect(pi_messages[1]).toMatchObject({
      role: 'assistant',
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-5.5',
      content: [{ type: 'toolCall', id: 'call_1', name: 'search' }],
    });
    expect(pi_messages[2]).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'search',
      isError: true,
      content: [{ type: 'text', text: 'No results.' }],
    });
    expect(JSON.stringify(pi_messages)).not.toContain('[tool_call');
    expect(JSON.stringify(pi_messages)).not.toContain('[tool_result');
  });

  it('preserves assistant thinking and usage metadata from Pi responses', () => {
    expect(
      pi_assistant_message_to_runtime_message(
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'I should inspect the image.',
              thinkingSignature: 'sig_thinking',
            },
            { type: 'text', text: 'The image shows a chart.' },
          ],
          api: 'openai-responses',
          provider: 'openai',
          model: 'gpt-5.5',
          usage: {
            input: 10,
            output: 20,
            cacheRead: 3,
            cacheWrite: 4,
            totalTokens: 37,
            cost: {
              input: 0.001,
              output: 0.002,
              cacheRead: 0.0001,
              cacheWrite: 0.0002,
              total: 0.0033,
            },
          },
          stopReason: 'stop',
          timestamp: 1,
        },
        { model_provider: 'openai', model_name: 'gpt-5.5' },
      ),
    ).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'I should inspect the image.', signature: 'sig_thinking' },
        { type: 'text', text: 'The image shows a chart.' },
      ],
      metadata: {
        api: 'openai-responses',
        usage: {
          input: 10,
          output: 20,
          totalTokens: 37,
        },
      },
    });
  });
});

describe('pi tool helpers', () => {
  it('passes node keys to Pi verbatim', () => {
    const input = create_test_engine_input('openai');
    expect(runtime_tools_to_pi_tools(input).map((tool) => tool.name)).toEqual([
      'runtime-search_context-1',
    ]);
  });

  it('returns tool-result image parts to the live pi loop (direct-mode screenshot path)', async () => {
    const result = await runtime_tool_result_to_agent_tool_result(
      {
        ok: true,
        content: [
          { type: 'text', text: '[1] @e1 button "Submit"' },
          { type: 'image', data: 'base64-png-bytes', mime_type: 'image/png' },
        ],
      },
      { tool_call_id: 'call_1', tool_name: 'browser' },
    );

    expect(result.content).toEqual([
      { type: 'text', text: '[1] @e1 button "Submit"' },
      { type: 'image', data: 'base64-png-bytes', mimeType: 'image/png' },
    ]);
  });

  it('sets the pi terminate hint when a terminal tool succeeds, but not for ordinary tools', async () => {
    const input: RuntimeAgentEngineInput = {
      ...create_test_engine_input('openai'),
      tools: [
        {
          tool_name: 'slack-respond-1',
          description: 'Respond in Slack.',
          ends_run_on_success: true,
          async execute() {
            return { ok: true, content_json: { accepted: true, delivered: true } };
          },
        },
        {
          tool_name: 'slack-respond_interim',
          description: 'Respond in Slack (interim).',
          ends_run_on_success: true,
          async execute() {
            return { ok: true, content_json: { accepted: true }, ends_run: false };
          },
        },
        {
          tool_name: 'runtime-search_context-1',
          description: 'Search context.',
          async execute() {
            return { ok: true, content_json: { answer: 'ok' } };
          },
        },
      ],
    };

    const [respond_tool, interim_tool, search_tool] = runtime_tools_to_pi_tools(input);
    const respond_result = await respond_tool?.execute('call_respond', {}, undefined);
    const interim_result = await interim_tool?.execute('call_interim', {}, undefined);
    const search_result = await search_tool?.execute('call_search', {}, undefined);

    expect(respond_result?.terminate).toBe(true);
    expect(interim_result?.terminate).toBeUndefined();
    expect(search_result?.terminate).toBeUndefined();
  });

  it('shows the model whether a failed tool call can be retried', async () => {
    const [tool] = runtime_tools_to_pi_tools({
      ...create_test_engine_input('openai'),
      tools: [
        {
          tool_name: 'runtime-provider_call-1',
          description: 'Calls a provider.',
          async execute() {
            return {
              ok: false,
              error_code: 'provider_unreachable',
              error_message: 'Provider timed out.',
              metadata: { retryable: true },
            };
          },
        },
      ],
    });

    await expect(tool?.execute('call_provider', {}, undefined)).rejects.toThrow(
      'Provider timed out. (code=provider_unreachable, retryable=true)',
    );
  });
});

async function collect_events(events: AsyncIterable<RuntimeAgentEngineEvent>) {
  const collected_events: RuntimeAgentEngineEvent[] = [];
  for await (const event of events) collected_events.push(event);
  return collected_events;
}

function create_test_engine_input(model_provider: string): RuntimeAgentEngineInput {
  return {
    run_key: 'run_test',
    session_key: 'session_test',
    system_prompt: 'Keep the response operational.',
    model: {
      model_provider,
      model_name: 'gpt-5.5',
      reasoning_level: 'low',
      temperature: 0.2,
    },
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Draft a launch update.' }],
      },
    ],
    tools: [
      {
        tool_name: 'runtime-search_context-1',
        description: 'Search context.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
        async execute() {
          return {
            ok: true,
            content_json: { answer: 'Workspace context checked.' },
          };
        },
      },
    ],
    metadata: {},
    signal: new AbortController().signal,
  };
}

function create_assistant_stream(options: {
  stopReason: 'stop' | 'error' | 'aborted';
  errorMessage?: string;
  content?: { type: 'text'; text: string }[];
}) {
  const message = {
    role: 'assistant' as const,
    content: options.content ?? [{ type: 'text' as const, text: 'Provider response.' }],
    api: 'openai-responses' as const,
    provider: 'openai',
    model: 'gpt-5.5',
    usage: {
      input: 10,
      output: 4,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 14,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: options.stopReason,
    ...(options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
    timestamp: Date.now(),
  };

  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'done', reason: options.stopReason, message };
    },
    async result() {
      return message;
    },
  };
}
