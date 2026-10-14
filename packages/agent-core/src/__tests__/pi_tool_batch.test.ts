import { create_pi_engine } from '@agent-core/engines/pi';
import type { RuntimeAgentEngineEvent, RuntimeAgentEngineInput } from '@agent-core/runs';
import type { RuntimeToolBatchCall, RuntimeToolDefinition } from '@agent-core/tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('a turn that needs a person', () => {
  it('runs nothing, answers every call the same way, and ends the run', async () => {
    const executed_tool_names: string[] = [];
    const decided_batches: RuntimeToolBatchCall[][] = [];
    stream_a_tool_batch_then_text();

    const events = await collect_events(
      create_pi_engine().run(
        create_engine_input({
          tools: create_tools(executed_tool_names),
          decide_tool_batch: async (calls) => {
            decided_batches.push([...calls]);
            return {
              kind: 'needs_approval',
              wait_for_answer: async () => ({
                answer: 'unanswered',
                message: 'Waiting for a person to approve this step.',
              }),
            };
          },
        }),
      ),
    );

    expect(executed_tool_names).toEqual([]);
    expect(decided_batches).toHaveLength(1);
    expect(decided_batches[0]?.map((call) => call.tool_name)).toEqual([
      'files-read-1',
      'gmail-send_email-1',
      'files-list-1',
    ]);
    expect(decided_batches[0]?.[1]?.input).toEqual({ to: 'anna@acme.com' });
    expect(pi_ai.stream_simple).toHaveBeenCalledTimes(1);
    const finished = read_finished_tool_calls(events);
    expect(finished).toHaveLength(3);
    for (const call of finished) {
      expect(call.details.ok).toBe(true);
      expect(call.details.content_text).toBe('Waiting for a person to approve this step.');
      expect(call.terminate).toBe(true);
    }
  });

  it('settles a sequential turn on one decision too', async () => {
    const executed_tool_names: string[] = [];
    const decided_batches: RuntimeToolBatchCall[][] = [];
    stream_a_tool_batch_then_text();

    await collect_events(
      create_pi_engine().run(
        create_engine_input({
          tools: create_tools(executed_tool_names).map((tool) => ({
            ...tool,
            execution_mode: 'sequential' as const,
          })),
          decide_tool_batch: async (calls) => {
            decided_batches.push([...calls]);
            return {
              kind: 'needs_approval',
              wait_for_answer: async () => ({ answer: 'unanswered', message: 'Waiting.' }),
            };
          },
        }),
      ),
    );

    expect(executed_tool_names).toEqual([]);
    expect(decided_batches).toHaveLength(1);
    expect(pi_ai.stream_simple).toHaveBeenCalledTimes(1);
  });
});

describe('an allowed tool batch', () => {
  it('runs every call and keeps the run going', async () => {
    const executed_tool_names: string[] = [];
    stream_a_tool_batch_then_text();

    await collect_events(
      create_pi_engine().run(
        create_engine_input({
          tools: create_tools(executed_tool_names),
          decide_tool_batch: async () => ({ kind: 'run' }),
        }),
      ),
    );

    expect(executed_tool_names).toEqual(['files-read-1', 'gmail-send_email-1', 'files-list-1']);
    expect(pi_ai.stream_simple).toHaveBeenCalledTimes(2);
  });

  it('runs every call when no decider is configured at all', async () => {
    const executed_tool_names: string[] = [];
    stream_a_tool_batch_then_text();

    await collect_events(
      create_pi_engine().run(create_engine_input({ tools: create_tools(executed_tool_names) })),
    );

    expect(executed_tool_names).toEqual(['files-read-1', 'gmail-send_email-1', 'files-list-1']);
  });
});

describe('continuing a run', () => {
  it('keeps the whole transcript when it ends in a tool result', async () => {
    pi_ai.stream_simple.mockReturnValue(create_text_stream('Continued.'));

    await collect_events(
      create_pi_engine().run(
        create_engine_input({
          tools: [],
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'Send the refund email.' }] },
            {
              role: 'assistant',
              content: [
                { type: 'tool_call', id: 'call_1', name: 'gmail-send_email-1', arguments: {} },
              ],
            },
            {
              role: 'tool',
              content: [
                {
                  type: 'tool_result',
                  tool_call_id: 'call_1',
                  tool_name: 'gmail-send_email-1',
                  result: { ok: true, content_text: 'Sent.' },
                },
              ],
            },
          ],
        }),
      ),
    );

    const [, context] = pi_ai.stream_simple.mock.calls[0] ?? [];
    expect((context as { messages: { role: string }[] }).messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
    ]);
  });
});

function create_tools(executed_tool_names: string[]): RuntimeToolDefinition[] {
  return ['files-read-1', 'gmail-send_email-1', 'files-list-1'].map((tool_name) => ({
    tool_name,
    description: `Run ${tool_name}.`,
    input_schema: { type: 'object', properties: {}, additionalProperties: true },
    async execute() {
      executed_tool_names.push(tool_name);
      return { ok: true as const, content_text: `${tool_name} ran.` };
    },
  }));
}

function create_engine_input(
  overrides: Partial<RuntimeAgentEngineInput> & { tools: RuntimeToolDefinition[] },
): RuntimeAgentEngineInput {
  return {
    run_key: 'run_test',
    session_key: 'session_test',
    system_prompt: 'Keep the response operational.',
    model: { model_provider: 'openai', model_name: 'gpt-5.5', reasoning_level: 'low' },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Do the thing.' }] }],
    metadata: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

function stream_a_tool_batch_then_text() {
  pi_ai.stream_simple
    .mockReturnValueOnce(
      create_stream([
        { type: 'toolCall', id: 'call_1', name: 'files-read-1', arguments: { path: 'a.txt' } },
        {
          type: 'toolCall',
          id: 'call_2',
          name: 'gmail-send_email-1',
          arguments: { to: 'anna@acme.com' },
        },
        { type: 'toolCall', id: 'call_3', name: 'files-list-1', arguments: { path: '.' } },
      ]),
    )
    .mockReturnValue(create_text_stream('All done.'));
}

function create_text_stream(text: string) {
  return create_stream([{ type: 'text', text }]);
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
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
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

type FinishedToolCall = {
  content: { type: string; text?: string }[];
  details: { ok: boolean; content_text?: string; ends_run?: boolean };
  terminate?: boolean;
};

function read_finished_tool_calls(events: RuntimeAgentEngineEvent[]): FinishedToolCall[] {
  return events.flatMap((event) =>
    event.type === 'progress' && event.label === 'pi.tool_execution_end'
      ? [(event.metadata as { result: FinishedToolCall }).result]
      : [],
  );
}

async function collect_events(events: AsyncIterable<RuntimeAgentEngineEvent>) {
  const collected: RuntimeAgentEngineEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}
