import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import type { RuntimeToolResult as PlatformRuntimeToolResult } from '@coworker/shared';
import { stringify_model_visible_tool_result } from '@runtime-platform/tools/model_visible_tool_result';

export const tool_result_v2_shape = 'tool_result_v2';

export type ToolResultFormat = 'runtime_tool_result' | 'platform_tool_result';

export type ToolResultV2 = Record<string, unknown> & {
  shape: typeof tool_result_v2_shape;
  result_format: ToolResultFormat;
  ok: boolean;
};

export function is_tool_result_v2(value: unknown): value is ToolResultV2 {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { shape?: unknown }).shape === tool_result_v2_shape
  );
}

export function tool_result_v2_from_runtime_result(result: RuntimeToolResult): ToolResultV2 {
  return { shape: tool_result_v2_shape, result_format: 'runtime_tool_result', ...result };
}

export function tool_result_v2_from_platform_result(
  result: PlatformRuntimeToolResult,
): ToolResultV2 {
  const envelope = platform_tool_result_to_runtime_tool_result(result);
  return {
    shape: tool_result_v2_shape,
    result_format: 'platform_tool_result',
    ...envelope,
    ...(result.success && result.model_visible_data !== undefined
      ? { model_visible_data: result.model_visible_data }
      : {}),
    ...(result.success && result.ends_run !== undefined ? { ends_run: result.ends_run } : {}),
  };
}

const tool_call_output_by_format: Record<ToolResultFormat, (stored: ToolResultV2) => unknown> = {
  runtime_tool_result: runtime_result_from_tool_result_v2,
  platform_tool_result: platform_result_from_tool_result_v2,
};

export function tool_call_output_from_tool_result_v2(stored: ToolResultV2) {
  return tool_call_output_by_format[stored.result_format](stored);
}

export function runtime_result_from_tool_result_v2(stored: ToolResultV2): RuntimeToolResult {
  const { shape: _shape, result_format: _result_format, ...result } = stored;
  return result as RuntimeToolResult;
}

export function platform_result_from_tool_result_v2(
  stored: ToolResultV2,
): PlatformRuntimeToolResult {
  const metadata = stored.metadata as Record<string, unknown> | undefined;
  if (!stored.ok) {
    return {
      success: false,
      error: { code: String(stored.error_code), message: String(stored.error_message) },
      ...(metadata === undefined ? {} : { metadata }),
    };
  }
  return {
    success: true,
    data: stored.content_json,
    ...(stored.model_visible_data === undefined
      ? {}
      : { model_visible_data: stored.model_visible_data }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(typeof stored.ends_run === 'boolean' ? { ends_run: stored.ends_run } : {}),
  };
}

export function message_result_from_tool_result_v2(stored: ToolResultV2): RuntimeToolResult {
  const { model_visible_data: _visible, ends_run: _ends_run, ...result } = stored;
  if (stored.result_format === 'runtime_tool_result') {
    return runtime_result_from_tool_result_v2(stored);
  }
  return runtime_result_from_tool_result_v2(result as ToolResultV2);
}

export function model_result_from_tool_result_v2(stored: ToolResultV2): RuntimeToolResult {
  if (stored.result_format === 'runtime_tool_result') {
    return runtime_result_from_tool_result_v2(stored);
  }
  const { model_visible_data: _visible, ...result } = stored;
  return runtime_result_from_tool_result_v2(result as ToolResultV2);
}

export function platform_tool_result_to_runtime_tool_result(
  result: PlatformRuntimeToolResult,
): RuntimeToolResult {
  if (result.success) {
    return {
      ok: true,
      content_json: result.data,
      content_text: stringify_model_visible_tool_result(result.model_visible_data ?? result.data),
      ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    };
  }

  return {
    ok: false,
    error_code: result.error?.code ?? 'tool_execution_failed',
    error_message: result.error?.message ?? 'Tool execution failed',
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
  };
}

export function platform_result_to_model_tool_result(
  result: PlatformRuntimeToolResult,
): RuntimeToolResult {
  if (result.success) {
    return {
      ok: true,
      content_text: stringify_model_visible_tool_result(result.model_visible_data ?? result.data),
      content_json: result.data,
      ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
      ...(result.ends_run === undefined ? {} : { ends_run: result.ends_run }),
      ...(result.reply_text === undefined ? {} : { reply_text: result.reply_text }),
    };
  }

  return {
    ok: false,
    error_code: result.error.code,
    error_message: result.error.message,
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
  };
}
