import { create_pi_engine } from '@agent-core/engines/pi/pi_engine';
import type { RuntimeAgentEngineEvent, RuntimeAgentEngineInput } from '@agent-core/runs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pi_ai = vi.hoisted(() => ({
  get_model: vi.fn(),
  stream_simple: vi.fn(async function* () {}),
}));

vi.mock('@agent-core/engines/pi/pi_models', () => ({
  get_pi_models: () => ({
    getModel: pi_ai.get_model,
    streamSimple: pi_ai.stream_simple,
  }),
}));

vi.mock('@earendil-works/pi-agent-core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Agent: class FakeAgent {
    private listeners: Array<(event: unknown, signal: AbortSignal) => Promise<void> | void> = [];

    constructor(private readonly options: FakeAgentOptions) {}

    subscribe(listener: (event: unknown, signal: AbortSignal) => Promise<void> | void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((candidate) => candidate !== listener);
      };
    }

    abort() {}

    async prompt(message: unknown) {
      await this.run_stream(message);
    }

    async continue() {
      await this.run_stream({
        role: 'user',
        content: [{ type: 'text', text: 'Continue.' }],
        timestamp: Date.now(),
      });
    }

    private async run_stream(message: unknown) {
      const api_key = await this.options.getApiKey?.(this.options.initialState.model.provider);
      const stream = await this.options.streamFn(
        this.options.initialState.model,
        {
          systemPrompt: this.options.initialState.systemPrompt,
          messages: [message],
          tools: this.options.initialState.tools,
        },
        {
          reasoning: this.options.initialState.thinkingLevel,
          sessionId: this.options.sessionId,
          transport: this.options.transport,
          apiKey: api_key,
        },
      );

      for await (const _event of stream) {
      }

      const signal = new AbortController().signal;
      await this.emit(
        {
          type: 'turn_end',
          message: assistant_message(),
          toolResults: [],
          context: { messages: [] },
          newMessages: [],
        },
        signal,
      );
    }

    private async emit(event: unknown, signal: AbortSignal) {
      for (const listener of this.listeners) {
        await listener(event, signal);
      }
    }
  },
}));

type FakeAgentModel = { provider: string } & Record<string, unknown>;

type FakeAgentOptions = {
  initialState: {
    model: FakeAgentModel;
    systemPrompt?: string;
    tools?: unknown[];
    thinkingLevel?: string;
  };
  streamFn: (
    model: FakeAgentModel,
    context: {
      systemPrompt: string | undefined;
      messages: unknown[];
      tools: unknown[] | undefined;
    },
    options: Record<string, unknown>,
  ) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
  getApiKey?: (provider: string) => string | undefined | Promise<string | undefined>;
  sessionId?: string;
  transport?: string;
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('create_pi_engine prompt caching', () => {
  it('requests long prompt-cache retention for agent-run provider calls', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
    pi_ai.get_model.mockReturnValue({
      provider: 'anthropic',
      id: 'claude-sonnet-4-5',
      model: 'claude-sonnet-4-5',
      input: ['text'],
    });
    const engine = create_pi_engine();

    await collect_events(engine.run(create_test_engine_input()));

    expect(pi_ai.stream_simple).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', id: 'claude-sonnet-4-5' }),
      expect.objectContaining({ systemPrompt: 'Keep the response operational.' }),
      expect.objectContaining({
        apiKey: 'test-anthropic-key',
        cacheRetention: 'long',
        maxRetries: 2,
        sessionId: 'session_test',
      }),
    );
  });

  it('gives the model call a deadline for silence', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
    pi_ai.get_model.mockReturnValue({
      provider: 'anthropic',
      id: 'claude-sonnet-4-5',
      model: 'claude-sonnet-4-5',
      input: ['text'],
    });
    const engine = create_pi_engine();

    await collect_events(engine.run(create_test_engine_input()));

    expect(pi_ai.stream_simple).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ timeoutMs: 300_000 }),
    );
  });

  it('keeps a retry budget alongside the deadline', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
    pi_ai.get_model.mockReturnValue({
      provider: 'anthropic',
      id: 'claude-sonnet-4-5',
      model: 'claude-sonnet-4-5',
      input: ['text'],
    });
    const engine = create_pi_engine();

    await collect_events(engine.run(create_test_engine_input()));

    expect(pi_ai.stream_simple).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        timeoutMs: expect.any(Number),
        maxRetries: expect.any(Number),
      }),
    );
  });
});

async function collect_events(events: AsyncIterable<RuntimeAgentEngineEvent>) {
  const collected_events: RuntimeAgentEngineEvent[] = [];
  for await (const event of events) collected_events.push(event);
  return collected_events;
}

function create_test_engine_input(): RuntimeAgentEngineInput {
  return {
    run_key: 'run_test',
    session_key: 'session_test',
    system_prompt: 'Keep the response operational.',
    model: {
      model_provider: 'anthropic',
      model_name: 'claude-sonnet-4-5',
      reasoning_level: 'medium',
    },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Use Anthropic.' }] }],
    tools: [],
    metadata: {},
    signal: new AbortController().signal,
  };
}

function assistant_message() {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'Caching is enabled.' }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    usage: {
      input: 10,
      output: 4,
      cacheRead: 0,
      cacheWrite: 10,
      totalTokens: 14,
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0.5, total: 3.5 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}
