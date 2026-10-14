import { file_fetch_host_format } from '@connectors/json_schema_formats';
import type { JsonSchema } from '@coworker/shared';

const value_expression: JsonSchema = {
  description: 'Any JSON. See value_expression.ts for the five $ operators.',
};

const input_path: JsonSchema = { type: 'string', pattern: '^[a-z0-9_]+(\\[\\])?(\\.[a-z0-9_]+)*$' };

export const node_reference: JsonSchema = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]*$' };

export function text_resolvers_schema(): JsonSchema {
  return {
    type: 'array',
    minItems: 1,
    items: {
      type: 'object',
      required: ['pattern', 'render'],
      additionalProperties: false,
      properties: {
        pattern: { type: 'string', minLength: 1 },
        lookup: { const: 'person' },
        render: { type: 'string', minLength: 1 },
      },
    },
  };
}

export function line_schema(): JsonSchema {
  return {
    type: 'object',
    required: ['author'],
    additionalProperties: false,
    properties: { author: value_expression, time: value_expression, text: value_expression },
  };
}

const host_or_two_label_wildcard_pattern =
  '^(\\*\\.[a-z0-9-]+(\\.[a-z0-9-]+)+|[a-z0-9-]+(\\.[a-z0-9-]+)*)$';

export const sync_file_fetch_schema: JsonSchema = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    node: node_reference,
    hosts: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        pattern: host_or_two_label_wildcard_pattern,
        format: file_fetch_host_format,
      },
    },
  },
};

export const sync_directory_schema: JsonSchema = {
  type: 'object',
  required: ['list_node', 'page', 'identity', 'display_name'],
  additionalProperties: false,
  properties: {
    list_node: node_reference,
    list_input: { type: 'object' },
    page: {
      type: 'object',
      required: ['items'],
      additionalProperties: false,
      properties: {
        items: value_expression,
        next_cursor: value_expression,
        cursor_param: input_path,
      },
    },
    identity: value_expression,
    display_name: value_expression,
    email: value_expression,
    person_kind: {
      type: 'object',
      additionalProperties: false,
      properties: { bot: value_expression, guest: value_expression },
    },
  },
};
