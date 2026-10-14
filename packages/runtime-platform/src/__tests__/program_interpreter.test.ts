import { run_program } from '@runtime-platform/tools/programs/program_interpreter';
import { describe, expect, it } from 'vitest';

describe('a model-written program in the interpreter', () => {
  it('calls host functions synchronously, loops, and returns a value', async () => {
    const seen: unknown[] = [];
    const outcome = await run_program({
      code: `
        const rows = read_file('tmp/message.md').split('\\n').filter(Boolean);
        for (const row of rows) call_tool('sheet-append', { row });
        console.log('rows', rows.length);
        return { count: rows.length };
      `,
      bindings: {
        read_file: async (path) => (path === 'tmp/message.md' ? 'a\nb\nc' : ''),
        call_tool: async (node_key, input) => {
          seen.push([node_key, input]);
          return { ok: true };
        },
      },
      deadline_ms: 5_000,
    });
    expect(outcome).toEqual({ ok: true, result: { count: 3 }, logs: ['rows 3'] });
    expect(seen).toEqual([
      ['sheet-append', { row: 'a' }],
      ['sheet-append', { row: 'b' }],
      ['sheet-append', { row: 'c' }],
    ]);
  });

  it('turns a host error into a catchable program error and reports uncaught ones', async () => {
    const caught = await run_program({
      code: `try { call_tool('x', {}); return 'not caught'; } catch (e) { return 'caught: ' + e.message; }`,
      bindings: {
        call_tool: async () => {
          throw new Error('tool refused');
        },
      },
      deadline_ms: 5_000,
    });
    expect(caught).toMatchObject({ ok: true, result: 'caught: tool refused' });
    const uncaught = await run_program({
      code: 'throw new TypeError("bad")',
      bindings: {},
      deadline_ms: 5_000,
    });
    expect(uncaught).toMatchObject({ ok: false, error: expect.stringContaining('TypeError: bad') });
  });

  it('stops a runaway loop at the deadline', async () => {
    const spinning = await run_program({ code: 'while (true) {}', bindings: {}, deadline_ms: 200 });
    expect(spinning).toMatchObject({ ok: false, error: expect.stringContaining('interrupted') });
  });

  it('stops a program that keeps collecting data at the memory limit, not at the deadline', async () => {
    const hungry = await run_program({
      code: 'const kept = []; while (true) kept.push("x".repeat(1000));',
      bindings: {},
      deadline_ms: 60_000,
      memory_limit_bytes: 8 * 1024 * 1024,
    });
    expect(hungry).toMatchObject({ ok: false, error: expect.stringContaining('more than 8 MB') });
  });

  it('refuses one value that is larger than the memory limit', async () => {
    const hungry = await run_program({
      code: 'return "x".repeat(16 * 1024 * 1024).length;',
      bindings: {},
      deadline_ms: 5_000,
      memory_limit_bytes: 8 * 1024 * 1024,
    });
    expect(hungry).toMatchObject({ ok: false, error: expect.stringContaining('out of memory') });
  });

  it('runs the next program after one was stopped for memory', async () => {
    await run_program({
      code: 'const kept = []; while (true) kept.push({ row: kept.length });',
      bindings: {},
      deadline_ms: 60_000,
      memory_limit_bytes: 8 * 1024 * 1024,
    });
    const next = await run_program({ code: 'return 1 + 1;', bindings: {}, deadline_ms: 5_000 });
    expect(next).toEqual({ ok: true, result: 2, logs: [] });
  });

  it('cannot reach the host: no require, no process, no fetch', async () => {
    const outcome = await run_program({
      code: 'return [typeof require, typeof process, typeof fetch, typeof globalThis.eval]',
      bindings: {},
      deadline_ms: 5_000,
    });
    expect(outcome).toMatchObject({
      ok: true,
      result: ['undefined', 'undefined', 'undefined', 'function'],
    });
  });
});
