import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_agent_run } from '@agent-core/runs';
import { describe, expect, it } from 'vitest';

describe('create_agent_run', () => {
  it('runs without a database and emits start, message, and end events', async () => {
    const run = create_agent_run({
      run_key: 'run_test',
      session_key: 'session_test',
      system_prompt: 'You are a test worker.',
      model: {
        model_provider: 'test',
        model_name: 'test-model',
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'hello core',
            },
          ],
        },
      ],
      tools: [],
      engine: test_agent_engine,
    });

    const events = [];
    for await (const event of run.events()) events.push(event);

    const result = await run.wait_for_completion();

    expect(events.map((event) => event.event_type)).toEqual(['start', 'message', 'end']);
    expect(events.map((event) => event.event_sequence)).toEqual([1, 2, 3]);
    expect(events.every((event) => event.event_id.startsWith('evt_'))).toBe(true);
    expect(events.every((event) => !event.event_id.includes('run_test'))).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.final_message?.role).toBe('assistant');
    expect(events[1]).toMatchObject({
      event_type: 'message',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Test agent response: hello core',
          },
        ],
      },
    });
  });

  it('fails instead of silently completing when the engine emits no assistant message', async () => {
    const run = create_agent_run({
      run_key: 'run_empty',
      session_key: 'session_test',
      system_prompt: 'You are a test worker.',
      model: {
        model_provider: 'test',
        model_name: 'test-model',
      },
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello core' }],
        },
      ],
      tools: [],
      engine: empty_agent_engine,
    });

    const events = [];
    for await (const event of run.events()) events.push(event);
    const result = await run.wait_for_completion();

    expect(events.map((event) => event.event_type)).toEqual(['start', 'error', 'end']);
    expect(result.status).toBe('failed');
    expect(result.error?.message).toBe('Runtime completed without an assistant message');
  });
});

const test_agent_engine: RuntimeAgentEngine = {
  engine_name: 'agent-core/core/test',
  async *run(input) {
    const latest_user_message = [...input.messages]
      .reverse()
      .find((message) => message.role === 'user');
    const text = latest_user_message?.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();

    yield {
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `Test agent response: ${text ?? ''}` }],
      },
    };
  },
};

const empty_agent_engine: RuntimeAgentEngine = {
  engine_name: 'agent-core/core/empty-test',
  async *run(input) {
    if (input.signal.aborted) {
      yield {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'aborted' }],
        },
      };
    }
  },
};
