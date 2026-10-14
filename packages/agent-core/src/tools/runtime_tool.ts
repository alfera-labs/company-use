import type { SessionEnv } from '@agent-core/environment/session_env';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import type { JSONSchema7 } from 'json-schema';

export type RuntimeJsonSchema = JSONSchema7;

export type RuntimeToolExecutionMode = 'parallel' | 'sequential';

export type RuntimeToolContext = {
  run_key: string;
  session_key?: string;
  tool_call_id?: string;
  environment?: SessionEnv;
  signal?: AbortSignal;
  metadata: Record<string, unknown>;
};

export type RuntimeToolBatchCall = {
  tool_call_id: string;
  tool_name: string;
  input: unknown;
};

export type RuntimeToolBatchAnswer =
  | { answer: 'approved' }
  | { answer: 'refused'; message: string }
  | { answer: 'unanswered'; message: string };

export type RuntimeToolBatchDecision =
  | { kind: 'run' }
  | {
      kind: 'needs_approval';
      wait_for_answer: (signal?: AbortSignal) => Promise<RuntimeToolBatchAnswer>;
    };

export type DecideRuntimeToolBatch = (
  calls: readonly RuntimeToolBatchCall[],
) => Promise<RuntimeToolBatchDecision>;

export type RuntimeToolDefinition = {
  tool_name: string;
  description: string;
  input_schema?: RuntimeJsonSchema;
  output_schema?: RuntimeJsonSchema;
  execution_mode?: RuntimeToolExecutionMode;
  metadata?: Record<string, unknown>;
  ends_run_on_success?: boolean;
  execute?: (input: unknown, context: RuntimeToolContext) => Promise<RuntimeToolResult>;
};
