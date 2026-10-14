import type { NodeInputSchemaData } from '@coworker/core/db/schema/json_column_types';

const default_headers_description = 'Headers forwarded to the upstream API.';

const methods_with_a_body = new Set(['post', 'put', 'patch']);

export function build_api_proxy_input_schema(input: {
  method: string;
  url_description: string;
  headers_description?: string | undefined;
}): NodeInputSchemaData {
  return {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: input.url_description,
      },
      query_parameters: {
        type: 'object',
        description: 'Query parameters forwarded to the upstream API.',
        additionalProperties: true,
      },
      headers: {
        type: 'object',
        description: input.headers_description ?? default_headers_description,
        additionalProperties: { type: 'string' },
      },
      ...(methods_with_a_body.has(input.method)
        ? {
            body: {
              type: 'object',
              description: 'JSON body forwarded to the upstream API.',
              additionalProperties: true,
            },
          }
        : {}),
    },
    required: ['url'],
    additionalProperties: false,
  };
}
