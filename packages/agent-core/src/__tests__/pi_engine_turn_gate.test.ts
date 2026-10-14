import { create_pi_engine } from '@agent-core/engines/pi';
import type { RuntimeAgentEngineEvent, RuntimeAgentEngineInput } from '@agent-core/runs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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
  return { ...original, get_pi_models: () => test_models };
});

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('a gate that lets every turn through', () => {
  it('is asked once per turn, counting from one, and changes nothing about the run', async () => {
    const asked_turns: number[] = [];
    stream_two_tool_turns_then_text();

    const events = await collect_events(
      create_pi_engine().run(
        create_engine_input({
          before_turn: async ({ turn_index }) => {
            asked_turns.push(turn_index);
          },
        }),
      ),
    );

    expect(asked_turns).toEqual([1, 2, 3]);
    expect(pi_ai.stream_simple).toHaveBeenCalledTimes(3);
    expect(read_message_texts(events)).toContain('All done.');
  });

  it('tells the gate what the run has spent so far, before the consumer has read a thing', async () => {
    const usage_at_each_turn: number[] = [];
    stream_two_tool_turns_then_text();

    await collect_events(
      create_pi_engine().run(
        create_engine_input({
          before_turn: async ({ usage }) => {
            usage_at_each_turn.push(usage.cost.total);
          },
        }),
      ),
    );

    expect(usage_at_each_turn).toEqual([0, 0.25, 0.5]);
  });
});

describe('a gate that stops the run', () => {
  it('stops before the turn it refused, and the run fails with the error the gate threw', async () => {
    stream_two_tool_turns_then_text();
    const stop = new Error('This workspace is out of credits.');

    const run = create_pi_engine().run(
      create_engine_input({
        before_turn: async ({ turn_index }) => {
          if (turn_index >= 2) throw stop;
        },
      }),
    );

    const collected: RuntimeAgentEngineEvent[] = [];
    await expect(collect_events(run, collected)).rejects.toBe(stop);

    expect(pi_ai.stream_simple).toHaveBeenCalledTimes(1);
    const messages = read_message_texts(collected);
    expect(messages).toEqual(['Working on it.']);
  });
});

describe('a before-turn hook that steers', () => {
  const save_text = 'Context is filling up. Save what you learned to memory files now.';

  beforeEach(() => {
    pi_ai.stream_simple.mockReset();
  });

  it('puts the hidden steer in the model input of its turn and keeps it there, out of the transcript', async () => {
    stream_two_tool_turns_then_text();

    const events = await collect_events(
      create_pi_engine().run(
        create_engine_input({
          before_turn: async ({ turn_index }) =>
            turn_index === 2
              ? { outcome: 'steer', steers: [{ text: save_text, hidden: true }] }
              : { outcome: 'continue' },
        }),
      ),
    );

    expect(read_request_user_texts(0)).toEqual(['Do the thing.']);
    expect(read_request_user_texts(1)).toEqual(['Do the thing.', save_text]);
    expect(read_request_user_texts(2)).toEqual(['Do the thing.', save_text]);
    expect(read_request_roles(1).at(-1)).toBe('user');
    expect(read_request_roles(2)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'user',
      'assistant',
      'toolResult',
    ]);
    expect(read_message_texts(events)).toEqual(['Working on it.', 'Still working.', 'All done.']);
    expect(read_hidden_steer_events(events)).toEqual([
      { content: { text: save_text }, metadata: { turn_index: 2, hidden: true } },
    ]);
  });

  it('never adds a model turn, even when it steers on the final turn', async () => {
    stream_two_tool_turns_then_text();

    const events = await collect_events(
      create_pi_engine().run(
        create_engine_input({
          before_turn: async ({ turn_index }) =>
            turn_index === 3
              ? { outcome: 'steer', steers: [{ text: save_text, hidden: true }] }
              : undefined,
        }),
      ),
    );

    expect(pi_ai.stream_simple).toHaveBeenCalledTimes(3);
    expect(read_request_user_texts(2)).toEqual(['Do the thing.', save_text]);
    expect(read_message_texts(events).at(-1)).toBe('All done.');
  });

  it('keeps every steer of a turn, in order', async () => {
    stream_two_tool_turns_then_text();

    await collect_events(
      create_pi_engine().run(
        create_engine_input({
          before_turn: async ({ turn_index }) =>
            turn_index === 1
              ? {
                  outcome: 'steer',
                  steers: [
                    { text: 'first', hidden: true },
                    { text: 'second', hidden: true },
                  ],
                }
              : { outcome: 'continue' },
        }),
      ),
    );

    expect(read_request_user_texts(0)).toEqual(['Do the thing.', 'first', 'second']);
    expect(read_request_user_texts(2)).toEqual(['Do the thing.', 'first', 'second']);
  });

  it('tells the hook how full the context is and how large the window is', async () => {
    const states: Array<{
      context_tokens: number | undefined;
      context_window: number | undefined;
    }> = [];
    stream_two_tool_turns_then_text();

    await collect_events(
      create_pi_engine().run(
        create_engine_input({
          before_turn: async ({ context_tokens, context_window }) => {
            states.push({ context_tokens, context_window });
          },
        }),
      ),
    );

    expect(states).toHaveLength(3);
    const windows = new Set(states.map((state) => state.context_window));
    expect(windows.size).toBe(1);
    expect([...windows][0]).toBeGreaterThan(100_000);
    expect(states[0]?.context_tokens).toBeGreaterThan(0);
    expect(states[2]?.context_tokens).toBeGreaterThan(states[0]?.context_tokens ?? 0);
  });
});

const request_context_schema = z.object({
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.union([
        z.string(),
        z.array(z.object({ type: z.string(), text: z.string().optional() })),
      ]),
    }),
  ),
});

function read_request_messages(call_index: number) {
  return request_context_schema.parse(pi_ai.stream_simple.mock.calls[call_index]?.[1]).messages;
}

function read_request_roles(call_index: number) {
  return read_request_messages(call_index).map((message) => message.role);
}

function read_request_user_texts(call_index: number) {
  return read_request_messages(call_index)
    .filter((message) => message.role === 'user')
    .flatMap((message) =>
      typeof message.content === 'string'
        ? [message.content]
        : message.content.flatMap((part) =>
            part.type === 'text' && part.text !== undefined ? [part.text] : [],
          ),
    );
}

function read_hidden_steer_events(events: RuntimeAgentEngineEvent[]) {
  return events.flatMap((event) =>
    event.type === 'progress' && event.label === 'run.hidden_steer'
      ? [{ content: event.content, metadata: event.metadata }]
      : [],
  );
}

function create_engine_input(overrides: Partial<RuntimeAgentEngineInput>): RuntimeAgentEngineInput {
  return {
    run_key: 'run_test',
    session_key: 'session_test',
    system_prompt: 'Keep the response operational.',
    model: { model_provider: 'openai', model_name: 'gpt-5.5', reasoning_level: 'low' },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Do the thing.' }] }],
    tools: [
      {
        tool_name: 'files-read-1',
        description: 'Read a file.',
        input_schema: { type: 'object', properties: {}, additionalProperties: true },
        async execute() {
          return { ok: true as const, content_text: 'file contents' };
        },
      },
    ],
    metadata: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

function stream_two_tool_turns_then_text() {
  pi_ai.stream_simple
    .mockReturnValueOnce(
      create_stream([
        { type: 'text', text: 'Working on it.' },
        { type: 'toolCall', id: 'call_1', name: 'files-read-1', arguments: { path: 'a.txt' } },
      ]),
    )
    .mockReturnValueOnce(
      create_stream([
        { type: 'text', text: 'Still working.' },
        { type: 'toolCall', id: 'call_2', name: 'files-read-1', arguments: { path: 'b.txt' } },
      ]),
    )
    .mockReturnValue(create_stream([{ type: 'text', text: 'All done.' }]));
}

function create_stream(content: unknown[]) {
  const message = {
    role: 'assistant' as const,
    content,
    api: 'openai-responses' as const,
    provider: 'openai',
    model: 'gpt-5.5',
    usage: {
      input: 10,
      output: 4,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 14,
      cost: { input: 0.2, output: 0.05, cacheRead: 0, cacheWrite: 0, total: 0.25 },
    },
    stopReason: content.some((part) => (part as { type: string }).type === 'toolCall')
      ? ('toolUse' as const)
      : ('stop' as const),
    timestamp: Date.now(),
  };

  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'done', reason: message.stopReason, message };
    },
    async result() {
      return message;
    },
  };
}

function read_message_texts(events: RuntimeAgentEngineEvent[]) {
  return events.flatMap((event) =>
    event.type === 'message'
      ? event.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      : [],
  );
}

async function collect_events(
  events: AsyncIterable<RuntimeAgentEngineEvent>,
  collected: RuntimeAgentEngineEvent[] = [],
) {
  for await (const event of events) collected.push(event);
  return collected;
}
