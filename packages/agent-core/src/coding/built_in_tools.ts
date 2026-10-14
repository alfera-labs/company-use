import { resize_image_parts_for_model } from '@agent-core/images/resize_image_parts';
import type {
  RuntimeJsonSchema,
  RuntimeToolContext,
  RuntimeToolDefinition,
} from '@agent-core/tools/runtime_tool';
import type {
  RuntimeToolContentPart,
  RuntimeToolResult,
} from '@agent-core/tools/runtime_tool_result';
import { format_error_message } from '@coworker/shared';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from '@earendil-works/pi-coding-agent';

const pi_coding_tool_templates = create_pi_coding_tools('/');

export function create_built_in_tools(): RuntimeToolDefinition[] {
  return pi_coding_tool_templates.map(create_runtime_tool_from_pi_tool);
}

function create_runtime_tool_from_pi_tool(tool: AgentTool): RuntimeToolDefinition {
  return {
    tool_name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as RuntimeJsonSchema,
    ...(tool.executionMode === undefined ? {} : { execution_mode: tool.executionMode }),
    metadata: {
      display_name: tool.label,
      source_package: '@earendil-works/pi-coding-agent',
    },
    execute: (input, context) => execute_pi_coding_tool(tool.name, input, context),
  };
}

async function execute_pi_coding_tool(
  tool_name: string,
  input: unknown,
  context: RuntimeToolContext,
): Promise<RuntimeToolResult> {
  const working_directory = context.environment?.working_directory;
  if (!working_directory) {
    return {
      ok: false,
      error_code: 'missing_environment',
      error_message: 'Pi coding tools require a session environment with a working directory.',
    };
  }

  const tool = create_pi_coding_tools(working_directory).find(
    (candidate) => candidate.name === tool_name,
  );
  if (!tool) {
    return {
      ok: false,
      error_code: 'unknown_pi_coding_tool',
      error_message: `Pi coding tool is not available: ${tool_name}`,
    };
  }

  try {
    const prepared_input = tool.prepareArguments ? tool.prepareArguments(input) : input;
    const result = await tool.execute(
      context.tool_call_id ?? `${context.run_key}:${tool_name}`,
      prepared_input,
    );
    const content = await resize_image_parts_for_model(pi_tool_result_content(result));
    const has_image = content.some((part) => part.type === 'image');
    return {
      ok: true,
      ...(has_image ? { content } : {}),
      content_text: pi_tool_result_text(result),
      content_json: has_image ? { ...result, content } : result,
      metadata: {
        pi_tool_name: tool.name,
        ...(result.terminate === undefined ? {} : { terminate: result.terminate }),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error_code: 'pi_coding_tool_failed',
      error_message: format_error_message(error),
    };
  }
}

function pi_tool_result_text(result: AgentToolResult<unknown>) {
  const text = result.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

  if (text) return text;
  return JSON.stringify(result.details ?? result.content);
}

function pi_tool_result_content(result: AgentToolResult<unknown>): RuntimeToolContentPart[] {
  return result.content.map((part) =>
    part.type === 'image'
      ? { type: 'image', data: part.data, mime_type: part.mimeType }
      : { type: 'text', text: part.text },
  );
}

function create_pi_coding_tools(working_directory: string): AgentTool[] {
  return [
    createReadTool(working_directory, { autoResizeImages: false }),
    createBashTool(working_directory),
    createEditTool(working_directory),
    createWriteTool(working_directory),
    createGrepTool(working_directory),
    createFindTool(working_directory),
    createLsTool(working_directory),
  ];
}
