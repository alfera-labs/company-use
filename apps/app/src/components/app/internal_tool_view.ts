import { read_tool_detail_output } from '@/components/prompt-kit/tool_detail_payload';

export type InternalToolFamily =
  | 'pages'
  | 'images'
  | 'files'
  | 'browser'
  | 'catalog'
  | 'connections'
  | 'skills'
  | 'schedules'
  | 'calculation'
  | 'assistant'
  | 'history';

export type InternalToolView = {
  summary?: string;
  notice?: string;
  items?: { title: string; detail?: string; url?: string; file_id?: string }[];
  fields?: { label: string; value: string }[];
  text?: string;
  images?: { title: string; image_url: string; source_url?: string }[];
  calculation?: { expression: string; result: string; exact?: boolean; fraction?: string };
  empty_message?: string;
};

export type InternalToolDefinition = {
  family: InternalToolFamily;
  title: string;
  read_view: (input: unknown, output: unknown) => InternalToolView | null;
};

export type InternalToolCall = {
  call_id: string;
  definition: InternalToolDefinition;
  error_text?: string;
  input?: unknown;
  output?: unknown;
  output_text?: string;
  state: string;
};

export type InternalToolCallState =
  | 'complete'
  | 'denied'
  | 'failed'
  | 'running'
  | 'stopped'
  | 'unreadable'
  | 'waiting';

const complete_states = new Set(['complete', 'completed', 'done', 'success', 'succeeded']);
const failed_states = new Set(['error', 'failed', 'timed_out']);
const stopped_states = new Set(['attempted', 'blocked', 'cancelled']);

export function read_internal_tool_view(call: InternalToolCall) {
  const output = read_tool_detail_output(parse_json_value(call.output));
  const view = call.definition.read_view(call.input, output);
  if (view) return view;
  const output_text = parse_output_text(call.output_text) ?? call.output_text;
  return call.definition.read_view(call.input, read_tool_detail_output(output_text));
}

export function read_internal_tool_call_state(
  call: Pick<InternalToolCall, 'error_text' | 'output' | 'output_text' | 'state'>,
  view: InternalToolView | null,
): InternalToolCallState {
  if (call.state === 'awaiting_approval') return 'waiting';
  if (call.state === 'denied') return 'denied';
  if (
    call.error_text ||
    failed_states.has(call.state) ||
    output_reports_failure(call.output) ||
    output_reports_failure(call.output_text)
  ) {
    return 'failed';
  }
  if (stopped_states.has(call.state)) return 'stopped';
  if (!complete_states.has(call.state)) return 'running';
  return view ? 'complete' : 'unreadable';
}

export function safe_http_url(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function safe_image_url(value: unknown) {
  const http_url = safe_http_url(value);
  if (http_url) return http_url;
  if (typeof value !== 'string') return null;
  return /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/iu.test(value) ? value : null;
}

export function safe_tool_url(value: unknown) {
  const http_url = safe_http_url(value);
  if (http_url) return http_url;
  if (typeof value !== 'string') return null;
  return /^\/scheduled-tasks(?:[/?#]|$)/u.test(value) ? value : null;
}

export function read_internal_tool_error(output: unknown, output_text?: string) {
  for (const candidate of [parse_json_value(output), parse_output_text(output_text)]) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    if (!('success' in candidate) || candidate.success !== false || !('error' in candidate))
      continue;
    const error = candidate.error;
    if (
      typeof error === 'object' &&
      error !== null &&
      !Array.isArray(error) &&
      'message' in error
    ) {
      return typeof error.message === 'string' ? error.message : undefined;
    }
  }
  return undefined;
}

function output_reports_failure(output: unknown) {
  const parsed_output = parse_json_value(output);
  return (
    typeof parsed_output === 'object' &&
    parsed_output !== null &&
    !Array.isArray(parsed_output) &&
    'success' in parsed_output &&
    parsed_output.success === false
  );
}

function parse_output_text(output_text: string | undefined) {
  if (!output_text?.trim()) return undefined;
  try {
    return JSON.parse(output_text) as unknown;
  } catch {
    return undefined;
  }
}

function parse_json_value(value: unknown) {
  if (typeof value !== 'string') return value;
  return parse_output_text(value) ?? value;
}
