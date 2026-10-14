import {
  catalog_node_key_pattern,
  input_path,
  node_key,
  recipe_cursor_schema,
  recipe_page_schema,
  recipe_read_items_batch_schema,
  value_expression,
} from '@connectors/composio/composio_recipe_page_schema';
import { built_in_relation_records } from '@connectors/relation_families';
import { record_path_schema } from '@connectors/sync/record_path_schema';
import type { JsonSchema } from '@coworker/shared';

export { catalog_node_key_pattern };

const known_relation_names = built_in_relation_records.map((record) => record.relation);

const toolkit_slug_pattern = '^[A-Z0-9]+(_[A-Z0-9]+)*$';

const node_call: JsonSchema = {
  type: 'object',
  required: ['node_key'],
  additionalProperties: false,
  properties: { node_key, input: { type: 'object' } },
};

function node_call_with(param_name: string): JsonSchema {
  return {
    type: 'object',
    required: ['node_key', param_name],
    additionalProperties: false,
    properties: { node_key, input: { type: 'object' }, [param_name]: input_path },
  };
}

const read_item: JsonSchema = {
  type: 'object',
  required: ['node_key', 'input', 'text'],
  additionalProperties: false,
  properties: { node_key, input: { type: 'object' }, text: value_expression },
};

const download_item: JsonSchema = {
  type: 'object',
  required: ['node_key', 'file_id_param', 'file_id', 'mime_type'],
  additionalProperties: false,
  properties: {
    node_key,
    file_id_param: input_path,
    export_param: input_path,
    file_id: value_expression,
    mime_type: value_expression,
    size_bytes: value_expression,
    export_formats: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } },
  },
};

const composio_recipe_object_schema: JsonSchema = {
  type: 'object',
  required: ['list_items', 'scoped_by', 'page', 'strategy', 'identity', 'title', 'item_kind'],
  anyOf: [
    { required: ['content'] },
    { required: ['read_item'] },
    { required: ['read_items_batch'] },
  ],
  additionalProperties: false,
  properties: {
    list_items: node_call,
    read_item,
    read_items_batch: recipe_read_items_batch_schema,
    download_item,
    scoped_by: {
      type: 'object',
      minProperties: 1,
      additionalProperties: { anyOf: [input_path, { type: 'null' }] },
    },
    page: recipe_page_schema,
    when: value_expression,
    strategy: { enum: ['relist_diff', 'modified_since', 'append_log'] },
    cursor: recipe_cursor_schema,
    edit_window_days: { type: 'number', exclusiveMinimum: 0 },
    listing_limit_note: { type: 'string', minLength: 1 },
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
      propertyNames: { enum: known_relation_names },
    },
    files: value_expression,
    file_fetch_input: { type: 'object', additionalProperties: value_expression },
    bucket: {
      type: 'object',
      additionalProperties: false,
      oneOf: [
        { required: ['by', 'of'], properties: { by: { const: 'day' }, of: value_expression } },
        { required: ['by', 'key'], properties: { by: { const: 'key' }, key: value_expression } },
      ],
      properties: { by: { enum: ['day', 'key'] }, of: value_expression, key: value_expression },
    },
    label: { type: 'string' },
    note: { type: 'string' },
  },
};

const composio_recipe_dimension_schema: JsonSchema = {
  type: 'object',
  required: ['key', 'label', 'shape'],
  additionalProperties: false,
  properties: {
    key: { type: 'string', pattern: '^[a-z0-9_]+$' },
    label: { type: 'string' },
    shape: { enum: ['tree', 'flat', 'query'] },
    list_scope_options: node_call,
    list_children: node_call_with('parent_id_param'),
    search: node_call_with('query_param'),
    option_items: value_expression,
    option_mapping: { type: 'object', additionalProperties: value_expression },
    option_when: value_expression,
    implicit_single_account: { const: true },
    search_param: { type: 'string' },
    allow_select_all: { type: 'boolean' },
    select_all_lists_unscoped: { const: true },
    placeholder: { type: 'string' },
    prompt: { type: 'string' },
  },
};

export const composio_recipe_schema: JsonSchema = {
  type: 'object',
  required: ['toolkit_slug', 'dimensions', 'objects'],
  additionalProperties: false,
  if: { required: ['unavailable_reason'] },
  else: { properties: { objects: { minProperties: 1 } } },
  properties: {
    toolkit_slug: { type: 'string', pattern: toolkit_slug_pattern },
    app_display_name: { type: 'string', minLength: 1 },
    unavailable_reason: { type: 'string', minLength: 1 },
    preferred_provider: { enum: ['native', 'composio'] },
    prompt: { type: 'string' },
    file_fetch: {
      type: 'object',
      required: ['node_key'],
      additionalProperties: false,
      properties: { node_key: { type: 'string', minLength: 1 } },
    },
    dimensions: { type: 'array', items: composio_recipe_dimension_schema },
    objects: {
      type: 'object',
      propertyNames: { pattern: '^[a-z0-9_]+$' },
      additionalProperties: composio_recipe_object_schema,
    },
  },
};
