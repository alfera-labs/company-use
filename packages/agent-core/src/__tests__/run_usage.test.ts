import type { RuntimeAgentEngine, RuntimeAgentEngineEvent } from '@agent-core/runs/agent_run';
import { create_agent_run } from '@agent-core/runs/create_agent_run';
import { add_run_usage, empty_run_usage, read_message_usage } from '@agent-core/runs/run_usage';
import { describe, expect, it } from 'vitest';

function turn(input: number, output: number, cache_read: number, cost: number) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: 'ok' }],
    metadata: {
      usage: {
        input,
        output,
        cacheRead: cache_read,
        cacheWrite: 0,
        totalTokens: input + output + cache_read,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
      },
    },
  };
}

function engine_emitting(events: RuntimeAgentEngineEvent[]): RuntimeAgentEngine {
  return {
    engine_name: 'fake',
    async *run() {
      for (const event of events) yield event;
    },
  };
}

function run_with(events: RuntimeAgentEngineEvent[]) {
  return create_agent_run({
    system_prompt: 'system',
    model: { model_provider: 'anthropic', model_proxy: 'anthropic_direct', model_name: 'test' },
    messages: [],
    tools: [],
    engine: engine_emitting(events),
  });
}

describe('run usage', () => {
  it('sums every turn instead of reporting the last one', async () => {
    const result = await run_with([
      { type: 'message', message: turn(5000, 100, 0, 0.02) },
      { type: 'message', message: turn(3, 200, 90_000, 0.05) },
      { type: 'message', message: turn(2, 183, 120_000, 0.08) },
    ]).wait_for_completion();

    expect(result.status).toBe('completed');
    expect(result.usage.input).toBe(5005);
    expect(result.usage.output).toBe(483);
    expect(result.usage.cacheRead).toBe(210_000);
    expect(result.usage.cost.total).toBeCloseTo(0.15);
    expect(result.usage.input).not.toBe(2);
  });

  it('reports what an aborted run already spent', async () => {
    let abort_run = () => {};
    const engine: RuntimeAgentEngine = {
      engine_name: 'fake',
      async *run() {
        yield { type: 'message', message: turn(4000, 120, 0, 0.03) };
        abort_run();
        yield { type: 'message', message: turn(2, 90, 50_000, 0.04) };
      },
    };
    const run = create_agent_run({
      system_prompt: 'system',
      model: { model_provider: 'anthropic', model_proxy: 'anthropic_direct', model_name: 'test' },
      messages: [],
      tools: [],
      engine,
    });
    abort_run = () => run.abort();
    const result = await run.wait_for_completion();

    expect(result.status).toBe('aborted');
    expect(result.usage.input).toBe(4000);
    expect(result.usage.output).toBe(120);
    expect(result.usage.cost.total).toBeCloseTo(0.03);
  });

  it('reports what a failed run spent before it threw', async () => {
    const engine: RuntimeAgentEngine = {
      engine_name: 'fake',
      async *run() {
        yield { type: 'message', message: turn(7000, 300, 0, 0.09) };
        throw new Error('provider exploded');
      },
    };
    const result = await create_agent_run({
      system_prompt: 'system',
      model: { model_provider: 'anthropic', model_proxy: 'anthropic_direct', model_name: 'test' },
      messages: [],
      tools: [],
      engine,
    }).wait_for_completion();

    expect(result.status).toBe('failed');
    expect(result.usage.input).toBe(7000);
    expect(result.usage.cost.total).toBeCloseTo(0.09);
  });

  it('derives a zero per-call total from the parts', () => {
    const usage = read_message_usage({
      role: 'assistant',
      content: [],
      metadata: {
        usage: {
          input: 10,
          output: 20,
          cacheRead: 30,
          cacheWrite: 40,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 },
        },
      },
    });
    expect(usage?.totalTokens).toBe(100);
  });

  it('treats a message with no cost block as no model call', () => {
    expect(read_message_usage({ role: 'assistant', content: [] })).toBeUndefined();
    expect(add_run_usage(empty_run_usage(), empty_run_usage()).totalTokens).toBe(0);
  });
});
