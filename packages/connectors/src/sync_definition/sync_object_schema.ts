import { record_path_schema } from '@connectors/sync/record_path_schema';
import {
  line_schema,
  node_reference,
  text_resolvers_schema,
} from '@connectors/sync_definition/sync_extension_schemas';
import type { JsonSchema } from '@coworker/shared';

const value_expression: JsonSchema = {
  description: 'Any JSON. See value_expression.ts for the five $ operators.',
};

const input_path: JsonSchema = { type: 'string', pattern: '^[a-z0-9_]+(\\[\\])?(\\.[a-z0-9_]+)*$' };

export const sync_object_schema: JsonSchema = {
  type: 'object',
  required: [
    'list_node',
    'scoped_by',
    'page',
    'strategy',
    'identity',
    'title',
    'content',
    'item_kind',
  ],
  additionalProperties: false,
  properties: {
    list_node: { type: 'string', pattern: '^[a-z0-9_]+-[a-z0-9_]+-[0-9]+$' },
    scoped_by: {
      type: 'object',
      minProperties: 1,
      additionalProperties: input_path,
    },
    list_input: { type: 'object' },
    page: {
      type: 'object',
      required: ['items'],
      additionalProperties: false,
      properties: {
        items: value_expression,
        next_cursor: value_expression,
        cursor_param: input_path,
        error: value_expression,
      },
    },
    when: value_expression,
    strategy: { enum: ['relist_diff', 'modified_since', 'append_log'] },
    cursor: {
      type: 'object',
      required: ['field', 'param'],
      additionalProperties: false,
      properties: {
        field: value_expression,
        param: input_path,
        overlap_minutes: { type: 'number', minimum: 0 },
        initial_lookback_days: { type: 'number', exclusiveMinimum: 0 },
        max_age_days: { type: 'number', exclusiveMinimum: 0 },
        expired_error_contains: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
        },
        marker_format: { enum: ['epoch_seconds', 'iso_time'] },
      },
    },
    edit_window_days: { type: 'number', exclusiveMinimum: 0 },
    identity: value_expression,
    version_signal: value_expression,
    tombstone: value_expression,
    title: value_expression,
    content: value_expression,
    item_kind: { type: 'string', pattern: '^[a-z0-9_]+$' },
    metadata: { type: 'object', additionalProperties: value_expression },
    container: {
      type: 'object',
      required: ['id'],
      additionalProperties: false,
      properties: { id: value_expression, path: value_expression },
    },
    path: record_path_schema,
    source_url: value_expression,
    relationships: {
      type: 'object',
      additionalProperties: value_expression,
    },
    text_resolvers: text_resolvers_schema(),
    line: line_schema(),
    files: value_expression,
    file_fetch_input: { type: 'object', additionalProperties: value_expression },
    bucket: {
      type: 'object',
      additionalProperties: false,
      oneOf: [
        {
          required: ['by', 'of'],
          properties: { by: { const: 'day' }, of: value_expression, scoped: false },
        },
        {
          required: ['by', 'key'],
          properties: { by: { const: 'key' }, key: value_expression },
        },
      ],
      properties: {
        by: { enum: ['day', 'key'] },
        of: value_expression,
        key: value_expression,
        scoped: { type: 'boolean' },
      },
    },
    label: { type: 'string' },
    note: { type: 'string' },
  },
};

export const read_content_schema: JsonSchema = {
  type: 'object',
  required: ['read_node', 'input', 'text'],
  additionalProperties: false,
  properties: {
    read_node: node_reference,
    input: { type: 'object' },
    text: value_expression,
  },
};

export const sync_objects_schema: JsonSchema = {
  type: 'object',
  minProperties: 1,
  propertyNames: { pattern: '^[a-z0-9_]+$' },
  additionalProperties: sync_object_schema,
};

export function is_read_content(
  content: unknown,
): content is { read_node: string; input: Record<string, unknown>; text: unknown } {
  return typeof content === 'object' && content !== null && 'read_node' in content;
}

export function is_scope_day_of(value: unknown): value is { scope_day_of: unknown } {
  return typeof value === 'object' && value !== null && 'scope_day_of' in value;
}
