import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import type { MessageContent } from '@coworker/shared';

export const run_message_v2_shape = 'run_message_v2';
export const tool_result_text_preview_chars = 1_024;

export type ToolResultMessagePointer = {
  shape: typeof run_message_v2_shape;
  parts: [{ type: 'tool_result'; tool_call_id: string }];
};

export type ToolResultMessageInput = {
  tool_call_id: string;
  model_tool_call_id?: string | undefined;
  tool_name: string;
  result: RuntimeToolResult;
};

export function is_tool_result_message_pointer(value: unknown): value is ToolResultMessagePointer {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { shape?: unknown }).shape === run_message_v2_shape
  );
}

export function tool_result_message_pointer(tool_call_id: string): ToolResultMessagePointer {
  return { shape: run_message_v2_shape, parts: [{ type: 'tool_result', tool_call_id }] };
}

export function runtime_tool_result_text(result: RuntimeToolResult) {
  if (!result.ok) return result.error_message;
  if (result.content_text) return result.content_text;
  return JSON.stringify(result.content_json ?? result.metadata ?? {});
}

export function tool_result_text_preview(result: RuntimeToolResult) {
  return runtime_tool_result_text(result).slice(0, tool_result_text_preview_chars);
}

const persisted_tool_result_limit_chars = 128_000;

export function bound_persisted_tool_result(result: RuntimeToolResult): RuntimeToolResult {
  if (!result.ok) return result;
  if (!result.content_text) return result;
  const serialized = JSON.stringify(result.content_json) ?? '';
  if (serialized.length <= persisted_tool_result_limit_chars) return result;

  return {
    ...result,
    content_json: {
      persisted_truncated: true,
      original_chars: serialized.length,
      preview: serialized.slice(0, persisted_tool_result_limit_chars),
      note: 'Full payload kept on the tool call. Fetch it with GET /v1/tool-calls/:tool_call_id.',
    },
  };
}

export function tool_result_message_content(input: ToolResultMessageInput): MessageContent {
  const text = runtime_tool_result_text(input.result);
  const result = bound_persisted_tool_result(input.result);
  const model_tool_call_id = input.model_tool_call_id ?? input.tool_call_id;
  return {
    type: 'tool_result',
    ...(text ? { text } : {}),
    parts: [
      {
        type: 'tool_result',
        tool_call_id: model_tool_call_id,
        tool_name: input.tool_name,
        result,
      },
    ],
    data: { tool_call_id: input.tool_call_id, model_tool_call_id, tool_name: input.tool_name },
  };
}
