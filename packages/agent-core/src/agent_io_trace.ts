import type { SessionEnv } from '@agent-core/environment/session_env';
import { model_config_without_credential } from '@agent-core/models/runtime_model_config';
import type { RuntimeAgentEngineInput } from '@agent-core/runs/agent_run';
import type { RuntimeToolDefinition } from '@agent-core/tools/runtime_tool';

const TRACE_ENV_NAME = 'COWORKER_TRACE_AGENT_IO';
const STREAM_TRACE_ENV_NAME = 'COWORKER_TRACE_AGENT_STREAM';

export function trace_agent_io(label: string, payload: unknown) {
  if (!is_agent_io_trace_enabled()) return;

  console.log(`[coworker-agent-io] ${label}`);
  console.dir(to_traceable_value(payload), {
    depth: null,
    colors: process.stdout.isTTY,
    maxArrayLength: null,
    maxStringLength: null,
  });
}

/**
 * Whether trace output is on, for a caller that has to MEASURE something before it can log it.
 * `trace_agent_io` discards its payload when tracing is off, but the caller has already built it —
 * fine for a value that was lying around, not for one that costs a JSON walk of the tool block on
 * every model call of every production run.
 */
export function is_agent_io_trace_on() {
  return is_agent_io_trace_enabled();
}

export function should_trace_agent_stream_events() {
  return parse_boolean_env(process.env[STREAM_TRACE_ENV_NAME]) === true;
}

export function traceable_engine_input(engine_name: string, input: RuntimeAgentEngineInput) {
  return {
    engine_name,
    run_key: input.run_key,
    ...(input.session_key === undefined ? {} : { session_key: input.session_key }),
    system_prompt: input.system_prompt,
    model: model_config_without_credential(input.model),
    messages: input.messages,
    tools: input.tools.map(traceable_runtime_tool),
    ...(input.environment === undefined
      ? {}
      : { environment: traceable_session_env(input.environment) }),
    metadata: input.metadata,
    signal: traceable_abort_signal(input.signal),
  };
}

function traceable_runtime_tool(tool: RuntimeToolDefinition) {
  return {
    tool_name: tool.tool_name,
    description: tool.description,
    ...(tool.input_schema === undefined ? {} : { input_schema: tool.input_schema }),
    ...(tool.output_schema === undefined ? {} : { output_schema: tool.output_schema }),
    ...(tool.execution_mode === undefined ? {} : { execution_mode: tool.execution_mode }),
    ...(tool.metadata === undefined ? {} : { metadata: tool.metadata }),
    executable: typeof tool.execute === 'function',
  };
}

function is_agent_io_trace_enabled() {
  const configured = parse_boolean_env(process.env[TRACE_ENV_NAME]);
  if (configured !== undefined) return configured;

  return false;
}

function parse_boolean_env(value: string | undefined) {
  const configured = value?.trim().toLowerCase();
  if (configured === '0' || configured === 'false' || configured === 'off') return false;
  if (configured === '1' || configured === 'true' || configured === 'on') return true;
  return undefined;
}

function traceable_session_env(environment: SessionEnv) {
  return {
    env_key: environment.env_key,
    env_kind: environment.env_kind,
    ...(environment.working_directory === undefined
      ? {}
      : { working_directory: environment.working_directory }),
    ...(environment.metadata === undefined ? {} : { metadata: environment.metadata }),
    capabilities: {
      exec: typeof environment.exec === 'function',
      read: typeof environment.read === 'function',
      write: typeof environment.write === 'function',
      edit: typeof environment.edit === 'function',
      list: typeof environment.list === 'function',
      grep: typeof environment.grep === 'function',
      glob: typeof environment.glob === 'function',
      read_file: typeof environment.read_file === 'function',
      write_file: typeof environment.write_file === 'function',
      run_command: typeof environment.run_command === 'function',
    },
  };
}

function traceable_abort_signal(signal: AbortSignal) {
  return {
    aborted: signal.aborted,
    reason: signal.aborted ? signal.reason : undefined,
  };
}

function to_traceable_value(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'function') return '[Function omitted]';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.toString();
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Map) {
    return {
      type: 'Map',
      entries: [...value.entries()].map(([key, entry]) => [
        to_traceable_value(key, seen),
        to_traceable_value(entry, seen),
      ]),
    };
  }

  if (value instanceof Set) {
    return {
      type: 'Set',
      values: [...value.values()].map((entry) => to_traceable_value(entry, seen)),
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => to_traceable_value(entry, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      should_redact_key(key) ? '[Redacted]' : to_traceable_value(entry, seen),
    ]),
  );
}

function should_redact_key(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return (
    normalized.includes('apikey') ||
    normalized.includes('authorization') ||
    normalized.includes('accesstoken') ||
    normalized.includes('refreshtoken') ||
    normalized.includes('secret') ||
    normalized === 'token'
  );
}
