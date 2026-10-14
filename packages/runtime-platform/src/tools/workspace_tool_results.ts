import type { SessionEnvCommandResult } from '@agent-core/environment';
import { resize_image_for_model } from '@agent-core/images/resize_image_for_model';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';

export function ok_text(
  content_text: string,
  metadata?: Record<string, unknown>,
): RuntimeToolResult {
  return {
    ok: true,
    content_text,
    content_json: { text: content_text },
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function ok_json(
  content_json: unknown,
  metadata?: Record<string, unknown>,
): RuntimeToolResult {
  return {
    ok: true,
    content_text: JSON.stringify(content_json),
    content_json,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export async function ok_image(
  summary: string,
  data: string,
  mime_type: string,
  metadata?: Record<string, unknown>,
): Promise<RuntimeToolResult> {
  const resized = await resize_image_for_model(data, mime_type);
  const image = resized ?? { data, mime_type, dimension_note: undefined };
  const text = image.dimension_note ? `${summary} ${image.dimension_note}` : summary;

  return {
    ok: true,
    content: [
      { type: 'text', text },
      { type: 'image', data: image.data, mime_type: image.mime_type },
    ],
    content_text: text,
    content_json: { summary: text, image: { mime_type: image.mime_type } },
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function err(
  error_code: string,
  error_message: string,
  metadata?: Record<string, unknown>,
): RuntimeToolResult {
  return {
    ok: false,
    error_code,
    error_message,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function with_result_metadata(
  result: RuntimeToolResult,
  metadata: Record<string, unknown>,
): RuntimeToolResult {
  return {
    ...result,
    metadata: {
      ...result.metadata,
      ...metadata,
    },
  };
}

export function command_result_text(result: SessionEnvCommandResult) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const status = result.timed_out
    ? 'Command timed out.'
    : result.exit_code === 0
      ? ''
      : `Command exited with code ${result.exit_code}.`;
  return [output, status].filter(Boolean).join('\n\n') || '(no output)';
}
