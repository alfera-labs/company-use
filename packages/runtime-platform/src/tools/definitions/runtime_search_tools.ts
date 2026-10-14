import { run_catalog_search } from '@runtime-platform/tools/catalog_search_execution';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  query: z.string().min(1),
  app_name: z.string().min(1).optional(),
  max_results: z.number().int().min(1).max(50).default(50),
  offset: z.number().int().min(0).default(0),
});

export const runtime_search_tools_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-search_tools-1',
  node_name: 'search_tools',
  display_name: 'Search tools',
  description:
    'Searches compact catalog pages, automatically scopes named connected apps, and prefers named tools over API proxies. Returned node_keys are identifiers, not callable tools. If a result carries schema, call runtime-execute_tool-1 with that node_key directly; otherwise call runtime-get_tool_schema-1 first.',
  category: 'context',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language or keyword search over tool and app capabilities.',
      },
      app_name: {
        type: 'string',
        description: 'Optional exact app name to narrow the search.',
      },
      max_results: {
        type: 'number',
        description: 'Desired results per compact page, up to 50. Use offset for more.',
      },
      offset: { type: 'number', description: 'Zero-based result offset for pagination.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      offset: { type: 'number' },
      execution_protocol: {
        type: 'object',
        properties: {
          node_keys_are_callable: { type: 'boolean' },
          schema_tool: { type: 'string' },
          execute_tool: { type: 'string' },
          schema_inlined_for: {
            type: 'string',
            description: 'node_key whose full schema is inlined as tools[0].schema.',
          },
        },
        required: ['node_keys_are_callable', 'schema_tool', 'execute_tool'],
      },
      result_count: { type: 'number' },
      tools: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            schema: {
              type: 'object',
              description:
                'Present on the top result only when it is unambiguous: the same object runtime-get_tool_schema-1 returns.',
            },
          },
        },
      },
      fallback_tools: { type: 'array', items: { type: 'object' } },
      has_more: { type: 'boolean' },
      next_offset: { type: ['number', 'null'] },
    },
    required: [
      'query',
      'offset',
      'execution_protocol',
      'result_count',
      'tools',
      'fallback_tools',
      'has_more',
      'next_offset',
    ],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.search_tools',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true, policy_exempt: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'runtime-search_tools-1 requires a runtime execution context.',
        },
      };
    }

    return run_catalog_search(input, context);
  },
};
