import type { JsonSchema } from '@coworker/shared';

export const value_expression: JsonSchema = {
  description: 'Any JSON. See value_expression.ts for the five $ operators.',
};

const input_name = '[^.\\[\\]\\s]+';

export const input_path: JsonSchema = {
  type: 'string',
  pattern: `^${input_name}(\\[\\])?(\\.${input_name})*$`,
};

export const catalog_node_key_pattern = '^[a-z0-9_]+-[a-z0-9_]+-[0-9]+$';

export const node_key: JsonSchema = { type: 'string', pattern: catalog_node_key_pattern };

export const recipe_page_schema: JsonSchema = {
  type: 'object',
  required: ['items'],
  additionalProperties: false,
  properties: {
    items: value_expression,
    next_cursor: value_expression,
    cursor_param: input_path,
    cursor_kind: { enum: ['token', 'page_number', 'offset', 'last_item'] },
    first_cursor: { type: 'integer', minimum: 0 },
    page_size: { type: 'integer', minimum: 1 },
    page_size_param: input_path,
    has_more: value_expression,
    error: value_expression,
  },
};

export const recipe_cursor_schema: JsonSchema = {
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
    marker_format: { enum: ['epoch_seconds', 'iso_time', 'iso_date'] },
    param_type: { enum: ['string', 'integer'] },
    template: {
      type: 'object',
      required: ['text', 'escape'],
      additionalProperties: false,
      properties: {
        text: { type: 'string', pattern: '\\{watermark\\}' },
        escape: { enum: ['sql_quote', 'backslash_quote', 'time_literal'] },
      },
    },
  },
};

export const recipe_read_items_batch_schema: JsonSchema = {
  type: 'object',
  required: ['node_key', 'ids_param', 'items', 'identity', 'text'],
  additionalProperties: false,
  properties: {
    node_key,
    ids_param: input_path,
    input: { type: 'object' },
    items: value_expression,
    identity: value_expression,
    text: value_expression,
    max_batch_size: { type: 'integer', minimum: 1 },
  },
};
