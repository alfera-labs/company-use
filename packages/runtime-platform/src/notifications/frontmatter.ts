const frontmatter_pattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u;

function strip_byte_order_mark(file_text: string) {
  return file_text.replace(/^﻿/u, '');
}

export function has_frontmatter(file_text: string) {
  return frontmatter_pattern.test(strip_byte_order_mark(file_text));
}

export function read_body_under_frontmatter(file_text: string): string {
  const match = frontmatter_pattern.exec(strip_byte_order_mark(file_text));
  return (match?.[2] ?? file_text).trim();
}

export function read_frontmatter(file_text: string): Record<string, unknown> {
  const match = frontmatter_pattern.exec(strip_byte_order_mark(file_text));
  if (!match) return {};
  const values: Record<string, unknown> = {};
  let open_child: Record<string, unknown> | null = null;
  for (const line of (match[1] ?? '').split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const raw_value = line.slice(separator + 1).trim();
    if (!key) continue;
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (open_child) open_child[key] = parse_yaml_scalar(raw_value);
      continue;
    }
    if (raw_value === '') {
      open_child = {};
      values[key] = open_child;
      continue;
    }
    open_child = null;
    values[key] = parse_yaml_scalar(raw_value);
  }
  return values;
}

function parse_yaml_scalar(raw_value: string): unknown {
  const unquoted = unquote(raw_value);
  if (unquoted === 'null' || unquoted === '~') return null;
  if (unquoted.startsWith('[') && unquoted.endsWith(']')) {
    return split_items(unquoted).map((item) => unquote(item));
  }
  if (unquoted.startsWith('{') && unquoted.endsWith('}')) {
    return Object.fromEntries(
      split_items(unquoted).map((item) => {
        const separator = item.indexOf(':');
        if (separator === -1) return [item, ''];
        return [
          unquote(item.slice(0, separator).trim()),
          unquote(item.slice(separator + 1).trim()),
        ];
      }),
    );
  }
  return unquoted;
}

function split_items(wrapped: string) {
  const inner = wrapped.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((item) => item.trim());
}

function unquote(value: string) {
  if (value.length >= 2 && /^(['"]).*\1$/su.test(value)) return value.slice(1, -1);
  return value;
}
