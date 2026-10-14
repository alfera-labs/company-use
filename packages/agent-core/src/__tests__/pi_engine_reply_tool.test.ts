import { create_pi_engine } from '@agent-core/engines/pi';
import type { RuntimeAgentEngineEvent, RuntimeAgentEngineInput } from '@agent-core/runs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pi_ai = vi.hoisted(() => ({
  stream_simple: vi.fn(),
}));

vi.mock('@earendil-works/pi-ai', async (import_original) => {
  const original = await import_original<typeof import('@earendil-works/pi-ai')>();
  return {
    ...original,
    createModels: (...args: Parameters<typeof original.createModels>) =>
      new Proxy(original.createModels(...args), {
        get(target, property) {
          if (property === 'streamSimple') return pi_ai.stream_simple;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
  };
});

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('a reply tool', () => {
  it('delivers its text as the assistant message and ends the turn', async () => {
    pi_ai.stream_simple.mockReturnValue(
      create_stream([
        { type: 'toolCall', id: 'call_1', name: 'chat-respond-1', arguments: { answer: 'Done.' } },
      ]),
    );

    const events = await collect_events(create_pi_engine().run(create_engine_input()));
    const messages = events.flatMap((event) => (event.type === 'message' ? [event.message] : []));

    expect(pi_ai.stream_simple).toHaveBeenCalledTimes(1);
    expect(read_message_texts(events)).toEqual(['Done. 3 rows added.']);
    expect(messages.at(-1)?.metadata).toMatchObject({ source: 'reply_tool', stop_reason: 'stop' });
  });

  it('delivers nothing when the reply is refused, and the model writes it again', async () => {
    pi_ai.stream_simple
      .mockReturnValueOnce(
        create_stream([
          { type: 'toolCall', id: 'call_1', name: 'chat-respond-1', arguments: { answer: 'x' } },
        ]),
      )
      .mockReturnValue(
        create_stream([
          { type: 'toolCall', id: 'call_2', name: 'chat-respond-1', arguments: { answer: 'y' } },
        ]),
      );
    let calls = 0;

    const events = await collect_events(
      create_pi_engine().run(
        create_engine_input({
          async execute() {
            calls += 1;
            return calls === 1
              ? {
                  ok: false as const,
                  error_code: 'invalid_input',
                  error_message: 'answer is too long',
                }
              : { ok: true as const, content_json: { delivered: true }, reply_text: 'Short now.' };
          },
        }),
      ),
    );

    expect(pi_ai.stream_simple).toHaveBeenCalledTimes(2);
    expect(read_message_texts(events)).toEqual(['Short now.']);
  });
});

async function deliver_done() {
  return {
    ok: true as const,
    content_json: { delivered: true },
    reply_text: 'Done. 3 rows added.',
  };
}

function create_engine_input(
  overrides: { execute?: () => Promise<unknown> } = {},
): RuntimeAgentEngineInput {
  return {
    run_key: 'run_test',
    session_key: 'session_test',
    system_prompt: 'Reply briefly.',
    model: { model_provider: 'openai', model_name: 'gpt-5.5', reasoning_level: 'low' },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Add the rows.' }] }],
    tools: [
      {
        tool_name: 'chat-respond-1',
        description: 'Reply in chat.',
        input_schema: { type: 'object', properties: {}, additionalProperties: true },
        ends_run_on_success: true,
        execute: (overrides.execute ?? deliver_done) as NonNullable<
          RuntimeAgentEngineInput['tools'][number]['execute']
        >,
      },
    ],
    metadata: {},
    signal: new AbortController().signal,
  };
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
