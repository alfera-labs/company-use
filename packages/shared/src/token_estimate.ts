import { model_visible_tool_text_limit_chars } from '@shared/model_visible_tool_text';

export function estimate_context_tokens_roughly(value: unknown) {
  const text =
    typeof value === 'string' ? value : JSON.stringify(normalize_for_token_estimate(value) ?? '');
  return Math.ceil(text.length / 4);
}

export function estimate_model_visible_message_tokens(message_content: unknown): number {
  const content = message_content as
    | { text?: unknown; data?: unknown; parts?: unknown }
    | null
    | undefined;
  const parts = Array.isArray(content?.parts) ? content.parts : null;
  if (!parts || parts.length === 0) return estimate_context_tokens_roughly(message_content);
  return parts.reduce<number>((total, part) => total + estimate_model_visible_part_tokens(part), 0);
}

// What one image costs the context, in characters, before the chars/4 conversion. This is pi's
// own number (ESTIMATED_IMAGE_CHARS in @earendil-works/pi-coding-agent's compaction), and matching
// it matters more than inventing a better one: pi's estimator already decides when this repo
// compacts, so a different number here means the window and the compactor disagree about the same
// history. It is still conservative — a 2000x1125 picture really costs the provider about 2,950
// tokens — but the elision it replaces priced every image at ~15 tokens, so nothing carrying a
// screenshot was ever heavy enough to evict and sessions grew images without bound.
const estimated_image_chars = 4_800;

function estimate_model_visible_part_tokens(part: unknown): number {
  if (part === null || typeof part !== 'object') return estimate_context_tokens_roughly(part);
  const record = part as Record<string, unknown>;

  if (record.type === 'image') return Math.ceil(estimated_image_chars / 4);

  if (record.type === 'tool_result') {
    const ceiling = Math.ceil(model_visible_tool_text_limit_chars / 4);
    const result = (record.result ?? {}) as Record<string, unknown>;
    const image_tokens = count_result_images(result) * Math.ceil(estimated_image_chars / 4);
    const text =
      typeof result.content_text === 'string'
        ? result.content_text
        : typeof result.error_message === 'string'
          ? result.error_message
          : null;
    if (text !== null) {
      return (
        Math.ceil(Math.min(text.length, model_visible_tool_text_limit_chars) / 4) + image_tokens
      );
    }
    return Math.min(estimate_context_tokens_roughly(result), ceiling) + image_tokens;
  }
  return estimate_context_tokens_roughly(record);
}

function count_result_images(result: Record<string, unknown>): number {
  const content = result.content;
  if (!Array.isArray(content)) return 0;
  return content.filter(
    (block) =>
      block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'image',
  ).length;
}

const base64_elision_threshold_chars = 8_192;
const base64_shape = /^[A-Za-z0-9+/=\s]+$/u;

function normalize_for_token_estimate(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalize_for_token_estimate);

  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (is_base64_payload(key, entry)) {
      normalized[key] = `[base64 data omitted; characters=${(entry as string).length}]`;
      continue;
    }

    normalized[key] = normalize_for_token_estimate(entry);
  }

  return normalized;
}

function is_base64_payload(key: string, entry: unknown): boolean {
  if (typeof entry !== 'string') return false;
  if (key !== 'data' && key !== 'content' && key !== 'body') return false;
  if (entry.length <= base64_elision_threshold_chars) return false;
  return base64_shape.test(entry.slice(0, 512));
}
