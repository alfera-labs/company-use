import { Buffer } from 'node:buffer';
import { parse_agent_browser_command_line } from '@agent-core/browser/agent_browser_command';
import { browser_command_failure } from '@agent-core/browser/browser_command_result';
import type {
  BrowserExecOptions,
  BrowserExecResult,
  BrowserSession,
} from '@agent-core/browser/types';
import { resize_image_for_model } from '@agent-core/images/resize_image_for_model';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';

type ScreenshotAnnotation = {
  number: number;
  ref: string;
  role: string;
  name: string;
};

export type ScreenshotPayload = {
  path: string;
  annotations: ScreenshotAnnotation[];
};

export function is_standalone_screenshot_command(command: string): boolean {
  if (!/^screenshot(\s|$)/.test(command)) return false;
  return !/[&|;<>`$\n]/.test(command);
}

export async function execute_screenshot_command(
  session: BrowserSession,
  command: string,
  options: BrowserExecOptions,
): Promise<RuntimeToolResult> {
  const parsed = parse_agent_browser_command_line(command);
  if (!parsed.ok) {
    return {
      ok: false,
      error_code: 'invalid_browser_command',
      error_message: parsed.error_message,
    };
  }
  const argv = parsed.argv.includes('--json') ? parsed.argv : [...parsed.argv, '--json'];
  const result = await session.exec(argv, options);
  const failure = browser_command_failure(command, result);
  if (failure) return failure;

  const base_metadata = { exit_code: result.exit_code, duration_ms: result.duration_ms };
  const payload = result.exit_code === 0 ? read_screenshot_payload(result.stdout) : undefined;
  if (!payload) {
    return { ok: true, content_text: screenshot_output_text(result), metadata: base_metadata };
  }

  const legend = screenshot_legend_text(payload);
  const metadata = { ...base_metadata, screenshot_path: payload.path };
  const image = await read_screenshot_image(session, payload.path, command);
  if (!image) {
    return {
      ok: true,
      content_text: `${legend}\n[the screenshot file could not be read back as an image]`,
      metadata,
    };
  }
  const text = image.dimension_note ? `${legend}\n${image.dimension_note}` : legend;
  return {
    ok: true,
    content: [
      { type: 'text', text },
      { type: 'image', data: image.data, mime_type: image.mime_type },
    ],
    content_text: text,
    metadata,
  };
}

function read_screenshot_payload(stdout: string): ScreenshotPayload | undefined {
  const parsed = parse_json(stdout);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const data = (parsed as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return undefined;
  const path = (data as { path?: unknown }).path;
  if (typeof path !== 'string' || path.length === 0) return undefined;
  return { path, annotations: read_annotations((data as { annotations?: unknown }).annotations) };
}

export function screenshot_legend_text(payload: ScreenshotPayload): string {
  const lines = payload.annotations.map(
    (annotation) =>
      `[${annotation.number}] @${annotation.ref} ${annotation.role} "${annotation.name}"`,
  );
  return [`Screenshot saved to ${payload.path}`, ...lines].join('\n');
}

export function screenshot_mime_type(command: string, path: string): string {
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/--screenshot-format[=\s]+jpeg/.test(command)) return 'image/jpeg';
  return 'image/png';
}

async function read_screenshot_image(
  session: BrowserSession,
  path: string,
  command: string,
): Promise<{ data: string; mime_type: string; dimension_note?: string } | undefined> {
  if (!session.read_bytes) return undefined;
  try {
    const bytes = await session.read_bytes(path);
    if (bytes.length === 0) return undefined;
    const data = Buffer.from(bytes).toString('base64');
    const mime_type = screenshot_mime_type(command, path);
    const resized = await resize_image_for_model(data, mime_type);
    if (!resized) return { data, mime_type };

    return {
      data: resized.data,
      mime_type: resized.mime_type,
      ...(resized.dimension_note === undefined ? {} : { dimension_note: resized.dimension_note }),
    };
  } catch {
    return undefined;
  }
}

function screenshot_output_text(result: BrowserExecResult): string {
  const parsed = parse_json(result.stdout);
  const error =
    parsed && typeof parsed === 'object' ? (parsed as { error?: unknown }).error : undefined;
  if (typeof error === 'string' && error) {
    return result.exit_code === 0 ? error : `[exit ${result.exit_code}] ${error}`;
  }
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (result.exit_code === 0) return stdout;
  return [stdout, stderr ? `[exit ${result.exit_code}] ${stderr}` : `[exit ${result.exit_code}]`]
    .filter(Boolean)
    .join('\n');
}

function read_annotations(value: unknown): ScreenshotAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.number !== 'number' || typeof record.ref !== 'string') return [];
    return [
      {
        number: record.number,
        ref: record.ref,
        role: typeof record.role === 'string' ? record.role : '',
        name: typeof record.name === 'string' ? record.name : '',
      },
    ];
  });
}

function parse_json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
