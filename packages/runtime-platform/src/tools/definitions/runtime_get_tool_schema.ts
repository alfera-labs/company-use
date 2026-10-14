import { get_tool_schema } from '@runtime-platform/tools/tool_schema';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  node_key: z.string().min(1),
  current_input: z.record(z.string(), z.unknown()).optional(),
  connection_id: z.string().min(1).optional(),
  schema_id: z.string().min(1).optional(),
});

export const runtime_get_tool_schema_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-get_tool_schema-1',
  node_name: 'get_tool_schema',
  display_name: 'Get tool schema',
  description:
    'Gets one tool input schema. Pass current_input when earlier choices change which fields are available.',
  category: 'context',
  input_schema: {
    type: 'object',
    properties: {
      node_key: {
        type: 'string',
        description: 'Exact tool key returned by runtime-search_tools-1.',
      },
      current_input: {
        type: 'object',
        description: 'Values chosen so far. Include this when later fields depend on them.',
        additionalProperties: true,
      },
      connection_id: {
        type: 'string',
        description: 'Connected account to use when more than one is available.',
      },
      schema_id: {
        type: 'string',
        description: 'Schema ID returned by an earlier call when continuing the same setup.',
      },
    },
    required: ['node_key'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      node_key: { type: 'string' },
      app_name: { type: 'string' },
      node_name: { type: 'string' },
      description: { type: ['string', 'null'] },
      category: { type: 'string' },
      requires_connection: { type: 'boolean' },
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      schema_id: { type: ['string', 'null'] },
      api_proxy_contract: { type: 'object' },
    },
    required: [
      'node_key',
      'app_name',
      'node_name',
      'requires_connection',
      'input_schema',
      'schema_id',
    ],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.get_tool_schema',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true, policy_exempt: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'runtime-get_tool_schema-1 requires a runtime execution context.',
        },
      };
    }

    return get_tool_schema(context.db, {
      workspace_id: context.workspace_id,
      session_id: context.session_id,
      run_id: context.run_id,
      ...(context.agent_id ? { agent_id: context.agent_id } : {}),
      actor_id: context.actor_id,
      ...(context.participants ? { participants: context.participants } : {}),
      room_private_to: context.room_private_to,
      node_key: input.node_key,
      ...(input.current_input === undefined ? {} : { current_input: input.current_input }),
      ...(context.speaker?.source_actor_id
        ? { acting_actor_id: context.speaker.source_actor_id }
        : {}),
      ...(input.connection_id ? { connection_id: input.connection_id } : {}),
      ...(input.schema_id ? { schema_id: input.schema_id } : {}),
    });
  },
};
