import { create_program_bindings } from '@runtime-platform/tools/programs/program_bindings';
import { run_program } from '@runtime-platform/tools/programs/program_interpreter';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  program: z.string().min(1).max(60_000),
  purpose: z.string().min(1).max(200).optional(),
});

const program_deadline_ms = 5 * 60_000;

export const runtime_run_program_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-run_program-1',
  node_name: 'run_program',
  display_name: 'Run a program',
  description:
    "Runs a short JavaScript program that calls tools itself, for work that moves data: many rows, many records, a list, a loop of calls. Inside the program, call_tool(node_key, input, { connection_id? }) runs a catalog tool and returns its output; call_tools([[node_key, input, options?], ...]) runs up to 5 independent calls at the same time and returns their outputs in order, with { error } in place of a failed call; read_file(path) returns a workspace file as text; console.log lines come back with the result. All are synchronous. Return a small summary; the program result, not the data it moved, is what you get back. Use runtime-execute_tool-1 directly for a single call, and for any tool that needs a person's approval.",
  category: 'actions',
  input_schema: {
    type: 'object',
    properties: {
      program: {
        type: 'string',
        description:
          'JavaScript. A function body: use `return` for the result. Available: call_tool(node_key, input, options?), call_tools([[node_key, input, options?], ...]), read_file(path), console.log. No imports, no fetch, no await needed.',
      },
      purpose: {
        type: 'string',
        description: 'One line on what the program does, shown to the person.',
      },
    },
    required: ['program'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      result: {},
      logs: { type: 'array', items: { type: 'string' } },
      tool_calls: { type: 'number' },
    },
    required: ['result', 'logs', 'tool_calls'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.run_program',
  approval_policy: { mode: 'none' },
  source_context_policy: { mode: 'current_turn' },
  metadata: {
    safe_for_first_milestone: true,
    policy_exempt: true,
    policy_delegates_to_catalog: true,
  },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'runtime-run_program-1 requires a runtime execution context.',
        },
      };
    }
    const bindings = create_program_bindings(context);
    const outcome = await run_program({
      code: input.program,
      bindings: bindings.functions,
      deadline_ms: program_deadline_ms,
    });
    if (!outcome.ok) {
      return {
        success: false,
        error: { code: 'program_failed', message: outcome.error },
        metadata: { logs: outcome.logs, tool_calls: bindings.tool_call_count() },
      };
    }
    return {
      success: true,
      data: { result: outcome.result, logs: outcome.logs, tool_calls: bindings.tool_call_count() },
      metadata: { source: 'run_program' },
    };
  },
  policy_timeout_ms: () => program_deadline_ms + 10_000,
};
