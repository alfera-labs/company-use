import {
  sync_directory_schema,
  sync_file_fetch_schema,
} from '@connectors/sync_definition/sync_extension_schemas';
import { sync_objects_schema } from '@connectors/sync_definition/sync_object_schema';
import type { JsonSchema } from '@coworker/shared';

const value_expression: JsonSchema = {
  description: 'Any JSON. See value_expression.ts for the five $ operators.',
};

const http_mapping_schema: JsonSchema = {
  type: 'object',
  required: ['method', 'path', 'response_schema'],
  additionalProperties: false,
  properties: {
    method: { enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    path: { type: 'string', minLength: 1 },
    query: { type: 'object' },
    body: value_expression,
    headers: { type: 'object' },
    paginate: {
      type: 'object',
      required: ['cursor_query_parameter', 'cursor_from_input'],
      additionalProperties: false,
      properties: {
        cursor_query_parameter: { type: 'string', minLength: 1 },
        cursor_from_input: value_expression,
        limit_query_parameter: { type: 'string', minLength: 1 },
        limit_from_input: value_expression,
      },
    },
    response_format: { enum: ['json', 'text'] },
    response_schema: { type: 'object' },
    to_output: value_expression,
  },
};

export const connector_node_definition_schema: JsonSchema = {
  type: 'object',
  required: ['node_key', 'description', 'input_schema', 'output_schema'],
  additionalProperties: true,
  properties: {
    node_key: { type: 'string', pattern: '^[a-z0-9_]+-[a-z0-9_]+-[0-9]+$' },
    description: { type: 'string', pattern: '\\S' },
    display_name: { type: 'string' },
    implementation: { enum: ['http', 'execute'] },
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
    http: http_mapping_schema,
    atomic: { type: 'boolean' },
    required_scopes: { type: 'array', items: { type: 'string' } },
    write_capable: { type: 'boolean' },
  },
};

const sync_declaration_schema: JsonSchema = {
  type: 'object',
  required: ['dimensions'],
  additionalProperties: true,
  properties: {
    prompt: { type: 'string' },
    objects: sync_objects_schema,
    directory: sync_directory_schema,
    file_fetch: sync_file_fetch_schema,
    dimensions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['key', 'label', 'shape'],
        additionalProperties: false,
        allOf: [
          {
            if: { properties: { shape: { const: 'query' } }, required: ['shape'] },
            else: { required: ['browse_node'] },
          },
        ],
        properties: {
          key: { type: 'string', pattern: '^[a-z0-9_]+$' },
          label: { type: 'string', pattern: '\\S' },
          shape: { enum: ['tree', 'flat', 'query'] },
          browse_node: { type: 'string', pattern: '^[a-z0-9_]+-[a-z0-9_]+-[0-9]+$' },
          option_mapping: { type: 'object' },
          browse_input: { type: 'object' },
          browse_request: { type: 'object' },
          search_param: { type: 'string', pattern: '^[a-z0-9_]+$' },
          selection_includes_descendants: { const: true },
          allow_select_all: { type: 'boolean' },
          placeholder: { type: 'string' },
          prompt: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
};

export const connector_app_definition_schema: JsonSchema = {
  type: 'object',
  required: ['app_key', 'display_name', 'base_url', 'rate_limits', 'auth'],
  additionalProperties: true,
  properties: {
    app_key: { type: 'string', pattern: '^[a-z0-9_]+$' },
    display_name: { type: 'string', pattern: '\\S' },
    base_url: { type: 'string', pattern: '^https?://' },
    rate_limits: {
      type: 'object',
      required: ['rpm', 'concurrency', 'burst'],
      additionalProperties: false,
      properties: {
        rpm: { type: 'number', exclusiveMinimum: 0 },
        concurrency: { type: 'integer', minimum: 1 },
        burst: { type: 'integer', minimum: 1 },
      },
    },
    auth: {
      type: 'object',
      required: ['kind'],
      additionalProperties: true,
      properties: {
        kind: { enum: ['oauth2', 'api_key', 'none'] },
        auth_url: { type: 'string' },
        token_url: { type: 'string' },
        scopes: { type: 'array', items: { type: 'string' } },
        authorization_params: { type: 'object', additionalProperties: { type: 'string' } },
        token_auth_method: { enum: ['client_secret_post', 'client_secret_basic'] },
        token_request_format: { enum: ['form', 'json'] },
        scope_separator: { enum: ['space', 'comma'] },
      },
    },
    sync: sync_declaration_schema,
    hidden: { type: 'boolean' },
    availability: {
      type: 'object',
      required: ['status', 'reason'],
      additionalProperties: false,
      properties: {
        status: { const: 'held' },
        reason: { type: 'string', pattern: '\\S' },
      },
    },
  },
};
