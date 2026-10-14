import { batch_of } from '@runtime-platform/tools/programs/program_bindings';
import { run_program } from '@runtime-platform/tools/programs/program_interpreter';
import { describe, expect, it } from 'vitest';

describe('call_tools in a program', () => {
  it('runs independent calls five at a time and returns outputs in order, with errors in place', async () => {
    let in_flight = 0;
    let most_in_flight = 0;
    const slow_tool = async (node_key: unknown, input: unknown) => {
      in_flight += 1;
      most_in_flight = Math.max(most_in_flight, in_flight);
      await new Promise((resolve) => setTimeout(resolve, 200));
      in_flight -= 1;
      const { q } = input as { q: string };
      if (q === 'bad') throw new Error(`${String(node_key)} refused`);
      return { answer: q.toUpperCase() };
    };
    const started = Date.now();
    const outcome = await run_program({
      code: `
        const qs = ['a', 'b', 'bad', 'c', 'd', 'e', 'f'];
        return call_tools(qs.map((q) => ['search', { q }]));
      `,
      bindings: { call_tool: slow_tool, call_tools: batch_of(slow_tool) },
      deadline_ms: 5_000,
    });
    const elapsed_ms = Date.now() - started;

    expect(outcome).toEqual({
      ok: true,
      logs: [],
      result: [
        { answer: 'A' },
        { answer: 'B' },
        { error: 'search refused' },
        { answer: 'C' },
        { answer: 'D' },
        { answer: 'E' },
        { answer: 'F' },
      ],
    });
    expect(most_in_flight).toBe(5);
    expect(elapsed_ms).toBeLessThan(7 * 200);
  });

  it('refuses a batch that is not an array', async () => {
    const outcome = await run_program({
      code: `return call_tools('search');`,
      bindings: { call_tools: batch_of(async () => null) },
      deadline_ms: 5_000,
    });
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining('needs an array') });
  });
});
