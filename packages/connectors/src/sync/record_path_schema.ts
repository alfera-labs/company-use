import {
  node_key,
  recipe_page_schema,
  value_expression,
} from '@connectors/composio/composio_recipe_page_schema';
import type { JsonSchema } from '@coworker/shared';

const path_text_schema: JsonSchema = {
  type: 'object',
  required: ['text'],
  additionalProperties: false,
  properties: {
    text: value_expression,
    strip_prefix: { type: 'string', minLength: 1 },
    split_on: { type: 'string', minLength: 1 },
  },
};

const folder_listing_schema: JsonSchema = {
  type: 'object',
  required: ['node_key', 'page', 'id', 'name'],
  additionalProperties: false,
  properties: {
    node_key,
    input: { type: 'object' },
    page: recipe_page_schema,
    id: value_expression,
    name: value_expression,
    parent_id: value_expression,
    when: value_expression,
  },
};

const parent_chain_schema: JsonSchema = {
  type: 'object',
  required: ['parent_ids', 'folders'],
  additionalProperties: false,
  properties: {
    parent_ids: value_expression,
    folders: folder_listing_schema,
    known_names: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } },
    name_separator: { type: 'string', minLength: 1 },
    root_name: { type: 'string', minLength: 1 },
    no_parent_name: { type: 'string', minLength: 1 },
  },
};

export const record_path_schema: JsonSchema = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    segments: { type: 'array', items: { anyOf: [path_text_schema, value_expression] } },
    parent_chain: parent_chain_schema,
  },
};
