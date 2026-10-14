import type { ObservedRunTrace } from '@coworker/evals/observed_run_trace';
import { redact_prompt_secrets } from '@coworker/runtime-platform';

const redaction_marker = '[redacted-secret]';
const sensitive_key_fragments = [
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'password',
  'privatekey',
  'secret',
  'token',
];
const labeled_secret =
  /(\b(?:password|passwd|secret|token|api[_ -]?key|authorization|cookie)\b\s*(?::|=|is)\s*)("[^"]*"|'[^']*'|[^\s,;]+)/giu;

export function build_compact_judge_trace(trace: ObservedRunTrace) {
  return {
    run: redact_judge_value(trace.run),
    messages: trace.messages.map((message) => ({
      role: message.message_role,
      kind: message.message_kind,
      visible: message.is_user_visible,
      text: truncate(redact_judge_text(message.content_text), 8_000),
    })),
    tool_calls: trace.tool_calls.map((tool_call, index) => ({
      evidence_id: `tool_${index + 1}`,
      name: tool_call.tool_name,
      status: tool_call.tool_status,
      risk_class: tool_call.risk_class,
      approval_mode: tool_call.approval_mode,
      input: truncate_json(redact_judge_value(tool_call.input_data), 2_000),
      output: truncate(redact_judge_text(tool_call.output_text), 2_000),
      error_code: tool_call.error_code,
      error_message: truncate(redact_judge_text(tool_call.error_message), 2_000),
    })),
    files: trace.files.map((artifact, index) =>
      redact_judge_value({
        evidence_id: `artifact_${index + 1}`,
        ...artifact,
        content_preview: truncate(redact_judge_text(artifact.content_preview), 2_000),
      }),
    ),
  };
}

export function redact_judge_value(value: unknown): unknown {
  if (typeof value === 'string') return redact_judge_text(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redact_judge_value);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      is_sensitive_key(key) ? redaction_marker : redact_judge_value(entry),
    ]),
  );
}

export function redact_judge_text(value: string | null | undefined) {
  return redact_prompt_secrets(value).replace(labeled_secret, `$1${redaction_marker}`);
}

function is_sensitive_key(key: string) {
  const normalized_key = key.toLowerCase().replace(/[^a-z]/gu, '');
  return sensitive_key_fragments.some((fragment) => normalized_key.includes(fragment));
}

function truncate_json(value: unknown, max_length: number) {
  return truncate(JSON.stringify(value), max_length);
}

function truncate(value: string | null | undefined, max_length: number) {
  if (!value) return null;
  return value.length <= max_length ? value : `${value.slice(0, max_length)}…`;
}
