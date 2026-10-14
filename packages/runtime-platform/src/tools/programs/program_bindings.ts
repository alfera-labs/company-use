import { format_error_message } from '@coworker/shared';
import { room_of_parent_call } from '@runtime-platform/tools/nested_tool_call_room';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';

const max_tool_calls_per_program = 500;
const max_file_bytes = 2 * 1024 * 1024;
const max_parallel_tool_calls = 5;
const catalog_transport_node_key = 'runtime-execute_tool-1';

type CallToolOptions = { connection_id?: string; output_fields?: string[] };

export function create_program_bindings(context: RuntimeToolExecutionContext) {
  let tool_call_count = 0;

  async function call_tool(node_key: unknown, input: unknown, options: unknown) {
    if (typeof node_key !== 'string' || !node_key) throw new Error('call_tool needs a node_key');
    if (context.allowed_tool_names && !context.allowed_tool_names.includes(node_key)) {
      throw new Error(`${node_key} is not available to this run`);
    }
    if (++tool_call_count > max_tool_calls_per_program) {
      throw new Error(`a program may make at most ${max_tool_calls_per_program} tool calls`);
    }
    const [{ execute_runtime_tool }, { find_tool_by_node_key }] = await Promise.all([
      import('@runtime-platform/tools/tool_execution_service'),
      import('@runtime-platform/tools/tool_registry'),
    ]);
    const call_options = (options ?? {}) as CallToolOptions;
    const is_platform_tool = Boolean(find_tool_by_node_key(node_key));
    const execution = await execute_runtime_tool(context.db, {
      workspace_id: context.workspace_id,
      session_id: context.session_id,
      run_id: context.run_id,
      ...(context.agent_id ? { agent_id: context.agent_id } : {}),
      actor_id: context.actor_id,
      node_key: is_platform_tool ? node_key : catalog_transport_node_key,
      tool_input: is_platform_tool
        ? (input ?? {})
        : {
            node_key,
            input: input ?? {},
            ...(call_options.connection_id ? { connection_id: call_options.connection_id } : {}),
            ...(call_options.output_fields ? { output_fields: call_options.output_fields } : {}),
          },
      ...(context.environment ? { environment: context.environment } : {}),
      ...(context.attachment_sources ? { attachment_sources: context.attachment_sources } : {}),
      ...(context.source_context ? { source_context: context.source_context } : {}),
      ...(context.speaker ? { speaker: context.speaker } : {}),
      ...(context.participants ? { participants: context.participants } : {}),
      ...room_of_parent_call(context),
      ...(context.signal ? { signal: context.signal } : {}),
      tool_result_is_model_visible: false,
    });
    const { result } = execution;
    if (!result.success)
      throw new Error(`${node_key}: ${result.error.code}: ${result.error.message}`);
    const data = result.data as { output?: unknown } | undefined;
    return data && typeof data === 'object' && 'output' in data ? data.output : data;
  }

  async function read_file(path: unknown) {
    if (typeof path !== 'string' || !path) throw new Error('read_file needs a path');
    if (!context.environment?.read) throw new Error('this run has no workspace to read from');
    const text = await context.environment.read(path);
    if (Buffer.byteLength(text, 'utf8') > max_file_bytes) {
      throw new Error(`${path} is larger than ${max_file_bytes} bytes`);
    }
    return text;
  }

  return {
    functions: { call_tool, call_tools: batch_of(call_tool), read_file },
    tool_call_count: () => tool_call_count,
  };
}

type CallTool = (node_key: unknown, input: unknown, options: unknown) => Promise<unknown>;

export function batch_of(call_tool: CallTool) {
  return async function call_tools(calls: unknown) {
    if (!Array.isArray(calls))
      throw new Error('call_tools needs an array of [node_key, input, options?]');
    const batch: unknown[] = calls;
    const results: unknown[] = new Array(batch.length);
    let next = 0;
    async function run_next_call(): Promise<void> {
      const index = next++;
      if (index >= batch.length) return;
      const [node_key, input, options] = Array.isArray(batch[index]) ? batch[index] : [];
      results[index] = await call_tool(node_key, input, options).catch((error: unknown) => ({
        error: format_error_message(error),
      }));
      return run_next_call();
    }
    const lanes = Math.min(max_parallel_tool_calls, batch.length);
    await Promise.all(Array.from({ length: lanes }, run_next_call));
    return results;
  };
}
