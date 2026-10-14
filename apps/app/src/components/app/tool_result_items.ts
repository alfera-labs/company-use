import { z } from 'zod';

export type ToolResultItem = {
  title: string;
  detail?: string | undefined;
  url?: string | undefined;
};

const title_field_names = [
  'title',
  'name',
  'subject',
  'label',
  'display_name',
  'filename',
  'path',
  'node_key',
  'key',
  'id',
];
const detail_field_names = [
  'description',
  'snippet',
  'summary',
  'text',
  'excerpt',
  'preview',
  'body',
];
const link_field_names = ['url', 'link', 'href', 'permalink', 'web_url', 'html_url', 'source_url'];

const list_field_names = [
  'results',
  'items',
  'data',
  'records',
  'rows',
  'matches',
  'hits',
  'files',
  'messages',
  'entries',
  'tools',
  'values',
];

const max_items_shown = 50;
const max_detail_length = 200;

export function read_tool_result_items(payload: unknown): ToolResultItem[] {
  const list = find_the_list(payload);
  if (!list) return [];

  const items = list.slice(0, max_items_shown).map(read_item);
  return items.every((item) => item !== null) ? (items as ToolResultItem[]) : [];
}

function find_the_list(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload.length > 0 ? payload : null;
  const parsed = result_entry.safeParse(payload);
  if (!parsed.success) return null;

  for (const field_name of list_field_names) {
    const value = parsed.data[field_name];
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return null;
}

const result_entry = z.record(z.string(), z.unknown());

function read_item(entry: unknown): ToolResultItem | null {
  if (typeof entry === 'string') return entry.trim() ? { title: entry.trim() } : null;
  const parsed = result_entry.safeParse(entry);
  if (!parsed.success) return null;

  const title = first_named_text(parsed.data, title_field_names);
  if (!title) return null;
  const detail = first_named_text(parsed.data, detail_field_names);
  const url = first_named_text(parsed.data, link_field_names);
  return {
    title,
    ...(detail ? { detail: clamp(detail) } : {}),
    ...(url ? { url } : {}),
  };
}

function first_named_text(entry: Record<string, unknown>, field_names: readonly string[]) {
  for (const field_name of field_names) {
    const value = entry[field_name];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

export function read_link_host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./iu, '');
  } catch {
    return '';
  }
}

function clamp(text: string) {
  const one_line = text.split(/\r?\n/u).join(' ').trim();
  return one_line.length > max_detail_length
    ? `${one_line.slice(0, max_detail_length).trimEnd()}…`
    : one_line;
}
