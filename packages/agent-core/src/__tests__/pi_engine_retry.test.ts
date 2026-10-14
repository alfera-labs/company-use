import { run_browser_agent } from '@agent-core/browser/browse_agent';
import { create_pi_engine } from '@agent-core/engines/pi';
import type { RuntimeRunEvent } from '@agent-core/events/runtime_event';
import { type AgentRun, type CreateAgentRunInput, create_agent_run } from '@agent-core/runs';
import { require_model_use_case_policy } from '@coworker/shared';
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

const max_attempts = require_model_use_case_policy('agent_run').maximum_retry_attempts;
const overloaded_error =
  '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  pi_ai.stream_simple.mockReset();
  vi.unstubAllEnvs();
});

describe('a transient provider error mid-stream', () => {
  it('retries the failed call and completes with the real answer', async () => {
    const usage_at_each_turn: number[] = [];
    pi_ai.stream_simple
      .mockReturnValueOnce(create_tool_call_stream())
      .mockReturnValueOnce(create_failing_stream(overloaded_error))
      .mockReturnValueOnce(create_answer_stream('Here is the report.'));

    const { events, result } = await drive_run(
      create_pi_run({
        before_turn: async ({ usage }) => {
          usage_at_each_turn.push(usage.cost.total);
        },
      }),
    );

    expect(result.status).toBe('completed');
    expect(read_message_texts(events)).toEqual(['Working on it.', 'Here is the report.']);
    expect(read_retry_events(events)).toEqual([
      expect.objectContaining({ attempt: 1, max_attempts, delay_ms: 1000 }),
    ]);
    expect(events.some((event) => event.event_type === 'error')).toBe(false);
    const retried_context = pi_ai.stream_simple.mock.calls[2]?.[1] as { messages: unknown[] };
    expect(retried_context.messages.at(-1)).toMatchObject({ role: 'toolResult' });
    expect(usage_at_each_turn).toEqual([0, 0.25, 0.5]);
    expect(result.usage.cost.total).toBe(0.75);
  });

  it('counts the failed attempt in the usage a crashed run is billed from', async () => {
    pi_ai.stream_simple
      .mockReturnValueOnce(create_failing_stream(overloaded_error))
      .mockReturnValueOnce(create_answer_stream('Here is the report.'));
    const run = create_pi_run();

    await drive_run(run);

    expect(run.usage().cost.total).toBe(0.5);
  });

  it('counts the tokens of the failed attempt in a browser sub-agent run', async () => {
    pi_ai.stream_simple
      .mockReturnValueOnce(create_failing_stream(overloaded_error))
      .mockReturnValueOnce(create_answer_stream('Title is Example Domain.'));
    const browser_output = { stdout: '', stderr: '', exit_code: 0, duration_ms: 1 };
    let finished = false;
    const running = run_browser_agent({
      session: {
        id: 'sandbox_test',
        exec: async () => browser_output,
        exec_raw: async () => browser_output,
      },
      goal: 'Report the title of example.com.',
      system_prompt: 'sp',
      model: { model_provider: 'openai', model_name: 'gpt-5.5', reasoning_level: 'low' },
      engine: create_pi_engine(),
    }).finally(() => {
      finished = true;
    });

    while (!finished) await vi.advanceTimersByTimeAsync(250);
    const result = await running;

    expect(result.final_text).toBe('Title is Example Domain.');
    expect(result).toMatchObject({ input_tokens: 20, output_tokens: 8, total_tokens: 28 });
  });
});

describe('errors that are not retried', () => {
  it('fails at once on an error the classifier calls permanent', async () => {
    pi_ai.stream_simple.mockReturnValue(
      create_failing_stream('Your credit balance is too low. Go to Plans & Billing.'),
    );

    const { events, result } = await drive_run(create_pi_run());

    expect(result.status).toBe('failed');
    expect(pi_ai.stream_simple).toHaveBeenCalledTimes(1);
    expect(read_retry_events(events)).toEqual([]);
  });

  it('fails after the retry budget is spent', async () => {
    pi_ai.stream_simple.mockImplementation(() => create_failing_stream(overloaded_error));

    const { events, result } = await drive_run(create_pi_run());

    expect(result.status).toBe('failed');
    expect(max_attempts).toBeGreaterThan(0);
    expect(pi_ai.stream_simple).toHaveBeenCalledTimes(max_attempts + 1);
    expect(read_retry_events(events).map((event) => event.delay_ms)).toEqual(
      Array.from({ length: max_attempts }, (_, index) => 1000 * 2 ** index),
    );
    expect(events.find((event) => event.event_type === 'error')).toMatchObject({
      error: { message: expect.stringContaining('Overloaded') },
    });
  });

  it('ends the run as cancelled when it is aborted during the backoff', async () => {
    pi_ai.stream_simple.mockImplementation(() => create_failing_stream(overloaded_error));
    const run = create_pi_run();

    const { result } = await drive_run(run, (event) => {
      if (event.event_type === 'progress' && event.label === 'pi.retry_scheduled') run.abort();
    });

    expect(result.status).toBe('aborted');
    expect(pi_ai.stream_simple).toHaveBeenCalledTimes(1);
  });
});

function create_pi_run(overrides: Partial<CreateAgentRunInput> = {}) {
  return create_agent_run({
    run_key: 'run_retry_test',
    session_key: 'session_test',
    system_prompt: 'Keep the response operational.',
    model: { model_provider: 'openai', model_name: 'gpt-5.5', reasoning_level: 'low' },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Write the report.' }] }],
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
    engine: create_pi_engine(),
    ...overrides,
  });
}

async function drive_run(run: AgentRun, on_event?: (event: RuntimeRunEvent) => void) {
  const events: RuntimeRunEvent[] = [];
  let finished = false;
  const reading = (async () => {
    for await (const event of run.events()) {
      events.push(event);
      on_event?.(event);
    }
  })().finally(() => {
    finished = true;
  });

  while (!finished) await vi.advanceTimersByTimeAsync(250);
  await reading;
  return { events, result: await run.wait_for_completion() };
}

function create_tool_call_stream() {
  return create_stream(
    create_assistant_message({
      content: [
        { type: 'text', text: 'Working on it.' },
        { type: 'toolCall', id: 'call_1', name: 'files-read-1', arguments: { path: 'a.txt' } },
      ],
      stopReason: 'toolUse',
    }),
  );
}

function create_answer_stream(text: string) {
  return create_stream(
    create_assistant_message({ content: [{ type: 'text', text }], stopReason: 'stop' }),
  );
}

function create_failing_stream(error_message: string) {
  const partial_text = 'Here is the rep';
  const message = create_assistant_message({
    content: [{ type: 'text', text: partial_text }],
    stopReason: 'error',
    errorMessage: error_message,
  });

  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'start', partial: { ...message, content: [], stopReason: 'stop' } };
      yield { type: 'text_delta', contentIndex: 0, delta: partial_text, partial: message };
      yield { type: 'error', reason: 'error', error: message };
    },
    async result() {
      return message;
    },
  };
}

function create_stream(message: ReturnType<typeof create_assistant_message>) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'done', reason: message.stopReason, message };
    },
    async result() {
      return message;
    },
  };
}

function create_assistant_message(options: {
  content: unknown[];
  stopReason: 'stop' | 'toolUse' | 'error';
  errorMessage?: string;
}) {
  return {
    role: 'assistant' as const,
    content: options.content,
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
    stopReason: options.stopReason,
    ...(options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
    timestamp: Date.now(),
  };
}

function read_message_texts(events: RuntimeRunEvent[]) {
  return events.flatMap((event) =>
    event.event_type === 'message'
      ? event.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      : [],
  );
}

function read_retry_events(events: RuntimeRunEvent[]) {
  return events.flatMap((event) =>
    event.event_type === 'progress' && event.label === 'pi.retry_scheduled'
      ? [event.metadata ?? {}]
      : [],
  );
}
