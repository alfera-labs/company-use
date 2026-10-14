import { page_cursor_to_send, watermark_value_to_send } from '@connectors/sync/page_cursor';
import { fill_watermark_template } from '@connectors/sync/watermark_template';
import type { ConnectorSyncCursor, ConnectorSyncObject } from '@connectors/sync_types';
import { z } from 'zod';

const input_branch_schema = z.record(z.string(), z.unknown()).catch(() => ({}));

export type ListRequest = {
  scope_id: string;
  page_cursor?: string | undefined;
  watermark?: string | undefined;
};

export function write_input_path(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  if (value === undefined || value === null) return;
  const steps = path.split('.');
  let cursor: Record<string, unknown> = target;

  for (const [index, step] of steps.entries()) {
    const is_row = step.endsWith('[]');
    const key = is_row ? step.slice(0, -2) : step;
    const is_last = index === steps.length - 1;

    if (is_last && is_row) {
      cursor[key] = [value];
      return;
    }
    if (is_last) {
      cursor[key] = value;
      return;
    }
    cursor = step_into(cursor, key, is_row);
  }
}

function step_into(cursor: Record<string, unknown>, key: string, is_row: boolean) {
  if (!is_row) {
    const next = input_branch_schema.parse(cursor[key]);
    cursor[key] = next;
    return next;
  }
  const array = Array.isArray(cursor[key]) ? (cursor[key] as unknown[]) : [];
  cursor[key] = array;
  const row = input_branch_schema.parse(array[0]);
  array[0] = row;
  return row;
}

export function build_list_input(
  recipe: ConnectorSyncObject,
  dimension_key: string,
  request: ListRequest,
): Record<string, unknown> {
  const input = structuredClone(recipe.list_input ?? {}) as Record<string, unknown>;
  const scope_path = recipe.scoped_by[dimension_key];
  if (scope_path === undefined) {
    throw new Error(`This sync object is not scoped by ${dimension_key}.`);
  }
  if (scope_path !== null) write_input_path(input, scope_path, request.scope_id);
  const { page } = recipe;
  if (page.cursor_param) {
    write_input_path(input, page.cursor_param, page_cursor_to_send(page, request.page_cursor));
  }
  if (page.page_size_param) write_input_path(input, page.page_size_param, page.page_size);
  if (recipe.cursor) {
    write_input_path(input, recipe.cursor.param, watermark_input(recipe.cursor, request.watermark));
  }
  return input;
}

function watermark_input(cursor: ConnectorSyncCursor, watermark: string | undefined) {
  const value = watermark_value_to_send(cursor, watermark);
  if (value === undefined || !cursor.template) return value;
  return fill_watermark_template(cursor.template, String(value));
}
