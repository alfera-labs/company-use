import type { TriggerFieldChoiceSource } from '@coworker/core/db/schema/json_column_types';
import { z } from 'zod';

export type Choice = { value: string; label: string };

const json_object_schema = z.record(z.string(), z.unknown());
const object_list_schema = z.array(json_object_schema).min(1);
const value_keys = ['id', 'value', 'key', 'slug'];
const label_keys = ['name', 'title', 'summary', 'label', 'display_name', 'full_name', 'email'];
const max_search_depth = 3;

export function read_choice_list(output: unknown, source: TriggerFieldChoiceSource): Choice[] {
  const by_value = new Map<string, Choice>();
  for (const item of find_items(output, source.items_path)) {
    const value = as_text(read_at_path(item, source.value_path)) ?? first_text(item, value_keys);
    if (!value || by_value.has(value)) continue;
    const label = as_text(read_at_path(item, source.label_path)) ?? first_text(item, label_keys);
    const words = label ?? value;
    // A name that is its own id is a provider constant (Gmail's INBOX); a person's label has an id
    // of its own (Label_12) and keeps its exact spelling, capitals included.
    by_value.set(value, { value, label: words === value ? readable(words) : words });
  }
  return [...by_value.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function find_items(output: unknown, items_path: readonly string[]) {
  const without_data = items_path[0] === 'data' ? items_path.slice(1) : null;
  for (const path of [items_path, without_data, ['data', ...items_path]]) {
    if (!path) continue;
    const items = object_list_schema.safeParse(read_at_path(output, path));
    if (items.success) return items.data;
  }
  return first_object_list(output, max_search_depth);
}

function first_object_list(value: unknown, depth: number): Record<string, unknown>[] {
  let level: unknown[] = [value];
  for (let step = 0; step <= depth; step += 1) {
    const next: unknown[] = [];
    for (const node of level) {
      const list = object_list_schema.safeParse(node);
      if (list.success) return list.data;
      const object = json_object_schema.safeParse(node);
      if (object.success) next.push(...Object.values(object.data));
    }
    level = next;
  }
  return [];
}

export function readable(label: string): string {
  if (!/^[A-Z0-9_]+$/.test(label) || !/[A-Z]/.test(label)) return label;
  const words = label.toLowerCase().split('_').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function read_at_path(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    const object = json_object_schema.safeParse(current);
    if (!object.success) return undefined;
    current = object.data[key];
  }
  return current;
}

function as_text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function first_text(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const text = as_text(item[key]);
    if (text) return text;
  }
  return null;
}
