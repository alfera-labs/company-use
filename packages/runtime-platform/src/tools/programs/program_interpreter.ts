import { format_error_message } from '@coworker/shared';
import {
  newQuickJSAsyncWASMModule,
  type QuickJSAsyncContext,
  type QuickJSAsyncRuntime,
  type QuickJSAsyncWASMModule,
} from 'quickjs-emscripten';

type ProgramBinding = (...args: unknown[]) => Promise<unknown>;

export type RunProgramInput = {
  code: string;
  bindings: Record<string, ProgramBinding>;
  deadline_ms: number;
  memory_limit_bytes?: number;
  max_log_chars?: number;
};

export type ProgramOutcome =
  | { ok: true; result: unknown; logs: string[] }
  | { ok: false; error: string; logs: string[] };

const default_memory_limit_bytes = 64 * 1024 * 1024;
const default_max_log_chars = 4_000;
const max_stack_bytes = 1024 * 1024;
const memory_check_interval_ms = 20;
const memory_used_when_the_engine_cannot_report_it = Number.POSITIVE_INFINITY;

let interpreter_module: Promise<QuickJSAsyncWASMModule> | undefined;

function load_interpreter() {
  interpreter_module ??= newQuickJSAsyncWASMModule();
  return interpreter_module;
}

export async function run_program(input: RunProgramInput): Promise<ProgramOutcome> {
  const module = await load_interpreter();
  const memory_limit_bytes = input.memory_limit_bytes ?? default_memory_limit_bytes;
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(memory_limit_bytes);
  runtime.setMaxStackSize(max_stack_bytes);
  const context = runtime.newContext();
  const limits = watch_program_limits(runtime, context, input.deadline_ms, memory_limit_bytes);
  runtime.setInterruptHandler(limits.is_over_a_limit);
  const logs: string[] = [];
  try {
    install_bindings(context, input.bindings, logs, input.max_log_chars ?? default_max_log_chars);
    const evaluated = await context.evalCodeAsync(wrap_as_function_body(input.code), 'program.js');
    if (evaluated.error) {
      const error = limits.memory_limit_error() ?? describe_thrown_value(context, evaluated.error);
      evaluated.error.dispose();
      return { ok: false, error, logs };
    }
    const result = context.dump(evaluated.value);
    evaluated.value.dispose();
    return { ok: true, result, logs };
  } catch (error) {
    return { ok: false, error: format_error_message(error), logs };
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

// The engine in this WebAssembly build counts allocations, not bytes: its own limit
// refuses one value larger than the limit and never the sum of many. The sum is measured here
// each time the engine asks whether to stop (every 10,000 loop steps), so a program can pass the
// limit between two checks. One interpreter instance per program, with a capped WebAssembly
// memory, is the hard limit.
function watch_program_limits(
  runtime: QuickJSAsyncRuntime,
  context: QuickJSAsyncContext,
  deadline_ms: number,
  memory_limit_bytes: number,
) {
  const deadline = Date.now() + deadline_ms;
  let next_memory_check = 0;
  let memory_limit_was_passed = false;
  return {
    is_over_a_limit() {
      const now = Date.now();
      if (now >= next_memory_check) {
        next_memory_check = now + memory_check_interval_ms;
        memory_limit_was_passed ||= read_memory_used_bytes(runtime, context) > memory_limit_bytes;
      }
      return memory_limit_was_passed || now > deadline;
    },
    memory_limit_error() {
      if (!memory_limit_was_passed) return undefined;
      const megabytes = Math.round(memory_limit_bytes / (1024 * 1024));
      return `The program held more than ${megabytes} MB of data at once. Keep less in memory: work in smaller batches.`;
    },
  };
}

function read_memory_used_bytes(runtime: QuickJSAsyncRuntime, context: QuickJSAsyncContext) {
  try {
    const usage = runtime.computeMemoryUsage();
    const used = context.getProp(usage, 'memory_used_size');
    const bytes = context.getNumber(used);
    used.dispose();
    usage.dispose();
    return bytes;
  } catch {
    return memory_used_when_the_engine_cannot_report_it;
  }
}

function wrap_as_function_body(code: string) {
  return `(function () {\n${code}\n})()`;
}

function install_bindings(
  context: QuickJSAsyncContext,
  bindings: Record<string, ProgramBinding>,
  logs: string[],
  max_log_chars: number,
) {
  for (const [name, binding] of Object.entries(bindings)) {
    const raw = context.newAsyncifiedFunction(`__${name}`, async (...handles) => {
      const args = handles.map((handle) => JSON.parse(context.dump(handle) as string) as unknown);
      const value = await binding(...args);
      return context.newString(JSON.stringify(value === undefined ? null : value));
    });
    context.setProp(context.global, `__${name}`, raw);
    raw.dispose();
    context
      .unwrapResult(
        context.evalCode(
          `globalThis.${name} = (...args) => JSON.parse(__${name}(...args.map((a) => JSON.stringify(a === undefined ? null : a))));`,
        ),
      )
      .dispose();
  }
  const log = context.newFunction('__log', (...handles) => {
    const line = handles.map((handle) => format_log_value(context.dump(handle))).join(' ');
    const used = logs.reduce((total, entry) => total + entry.length, 0);
    if (used < max_log_chars) logs.push(line.slice(0, max_log_chars - used));
  });
  context.setProp(context.global, '__log', log);
  log.dispose();
  context
    .unwrapResult(
      context.evalCode(
        'globalThis.console = { log: (...a) => __log(...a), error: (...a) => __log(...a), warn: (...a) => __log(...a) };',
      ),
    )
    .dispose();
}

function format_log_value(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function describe_thrown_value(
  context: QuickJSAsyncContext,
  handle: Parameters<typeof context.dump>[0],
) {
  const thrown = context.dump(handle) as
    | { name?: string; message?: string; stack?: string }
    | string;
  if (typeof thrown === 'string') return thrown;
  const where = thrown.stack?.split('\n')[1]?.trim();
  return `${thrown.name ?? 'Error'}: ${thrown.message ?? ''}${where ? ` (${where})` : ''}`;
}
