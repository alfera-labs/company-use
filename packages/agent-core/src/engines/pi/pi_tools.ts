import { image_part_for_model } from '@agent-core/engines/pi/pi_image_content';
import type { PiToolBatchDecider, UnrunAnswer } from '@agent-core/engines/pi/pi_tool_batch';
import type { RuntimeAgentEngineInput } from '@agent-core/runs/agent_run';
import type { RuntimeToolDefinition } from '@agent-core/tools/runtime_tool';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import { cap_model_visible_tool_text, validate_model_tool_name } from '@coworker/shared';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { type TSchema, Type } from '@earendil-works/pi-ai';

export function runtime_tools_to_pi_tools(
  input: RuntimeAgentEngineInput,
  batch_decider?: PiToolBatchDecider,
): AgentTool[] {
  return input.tools.map((tool) => runtime_tool_to_pi_tool(tool, input, batch_decider));
}

export function runtime_tool_to_pi_tool(
  tool: RuntimeToolDefinition,
  input: RuntimeAgentEngineInput,
  batch_decider?: PiToolBatchDecider,
): AgentTool {
  return {
    name: validate_model_tool_name(tool.tool_name),
    label: String(tool.metadata?.display_name ?? tool.tool_name),
    description: tool.description,
    parameters: (tool.input_schema ?? Type.Object({})) as TSchema,
    ...(tool.execution_mode === undefined ? {} : { executionMode: tool.execution_mode }),
    prepareArguments: (args) =>
      args && typeof args === 'object' && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {},
    async execute(tool_call_id, params, signal) {
      if (!tool.execute) {
        throw new Error(`Tool ${tool.tool_name} is not executable`);
      }

      const answer = batch_decider?.find_answer(tool_call_id);
      if (answer) {
        return unrun_tool_result(answer, { tool_call_id, tool_name: tool.tool_name });
      }

      const result = await tool.execute(params, {
        run_key: input.run_key,
        ...(input.session_key === undefined ? {} : { session_key: input.session_key }),
        tool_call_id,
        ...(input.environment === undefined ? {} : { environment: input.environment }),
        ...(signal === undefined ? {} : { signal }),
        metadata: input.metadata,
      });

      if (!result.ok) {
        throw new Error(model_visible_tool_error(result));
      }

      const agent_result = runtime_tool_result_to_agent_tool_result(result, {
        tool_call_id,
        tool_name: tool.tool_name,
      });
      const terminate = result.ends_run ?? tool.ends_run_on_success;
      return terminate ? { ...agent_result, terminate: true } : agent_result;
    },
  };
}

// A call that did not run answers with a real, well-formed tool result, never an error: the model
// must have nothing to route around, retry, or apologize for.
//
// A refusal keeps the run going — the model has been told no and can still do the rest of its
// work. Only "nobody answered" ends the run, and it ends it through pi's all-or-nothing early
// stop, which fires because every call in the turn answers the same way.
function unrun_tool_result(
  answer: UnrunAnswer,
  metadata: Record<string, unknown>,
): AgentToolResult<RuntimeToolResult> {
  const ends_run = answer.answer === 'unanswered';
  const result: RuntimeToolResult = { ok: true, content_text: answer.message, ends_run };
  const agent_result = runtime_tool_result_to_agent_tool_result(result, metadata);
  return ends_run ? { ...agent_result, terminate: true } : agent_result;
}

function model_visible_tool_error(result: Extract<RuntimeToolResult, { ok: false }>) {
  const retryable = result.metadata?.retryable;
  const details = [
    `code=${result.error_code}`,
    ...(typeof retryable === 'boolean' ? [`retryable=${retryable}`] : []),
  ];
  return `${result.error_message} (${details.join(', ')})`;
}

export function runtime_tool_result_to_agent_tool_result(
  result: RuntimeToolResult,
  metadata: Record<string, unknown>,
): AgentToolResult<RuntimeToolResult> {
  return {
    content: runtime_tool_result_content(result),
    details: { ...result, metadata },
  };
}

function runtime_tool_result_content(
  result: RuntimeToolResult,
): AgentToolResult<RuntimeToolResult>['content'] {
  const content =
    result.content?.map((part) => {
      if (part.type === 'image') return image_part_for_model(part.data, part.mime_type);

      return { type: 'text' as const, text: part.text };
    }) ?? [];

  return cap_tool_result_text_parts(
    content.length > 0 ? content : [{ type: 'text', text: runtime_tool_result_text(result) }],
  );
}

export function cap_tool_result_text_parts<T extends { type: string; text?: string }>(parts: T[]) {
  return parts.map((part) =>
    part.type === 'text' && typeof part.text === 'string'
      ? { ...part, text: cap_model_visible_tool_text(part.text) }
      : part,
  );
}

function runtime_tool_result_text(result: RuntimeToolResult) {
  if (!result.ok) return result.error_message;
  if (result.content_text) return result.content_text;
  return JSON.stringify(result.content_json ?? result.metadata ?? {});
}
