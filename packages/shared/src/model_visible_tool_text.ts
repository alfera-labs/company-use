export const model_visible_tool_text_limit_chars = 16_000;
export const model_visible_tool_text_head_chars = 14_000;
export const model_visible_tool_text_tail_chars = 1_500;

export function cap_model_visible_tool_text(text: string) {
  if (text.length <= model_visible_tool_text_limit_chars) return text;

  const head = text.slice(0, model_visible_tool_text_head_chars);
  const tail = text.slice(-model_visible_tool_text_tail_chars);
  const omitted_characters = text.length - head.length - tail.length;
  return `${head}${truncation_notice(text.length, omitted_characters)}${tail}`;
}

function truncation_notice(total_characters: number, omitted_characters: number) {
  return [
    '\n[truncated:',
    `${omitted_characters} of ${total_characters} characters omitted from the middle.`,
    'The dropped middle cannot be read back, so refetch narrower instead:',
    'tighter query parameters, pagination, or output_fields.]\n',
  ].join(' ');
}

export function cap_strings_in_tool_payload<T>(value: T): T {
  if (typeof value === 'string') return cap_model_visible_tool_text(value) as T;
  if (Array.isArray(value)) {
    const items = value.map((item) => cap_strings_in_tool_payload(item));
    return items.every((item, index) => item === value[index]) ? value : (items as T);
  }
  if (value === null || typeof value !== 'object') return value;

  const entries = Object.entries(value as Record<string, unknown>);
  const capped = entries.map(
    ([key, nested]) => [key, cap_strings_in_tool_payload(nested)] as const,
  );
  return capped.every(([, nested], index) => nested === entries[index]?.[1])
    ? value
    : (Object.fromEntries(capped) as T);
}
