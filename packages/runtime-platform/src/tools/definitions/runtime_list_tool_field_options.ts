import { list_tool_field_options } from '@runtime-platform/tools/tool_field_options';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  node_key: z.string().min(1),
  field_name: z.string().min(1),
  current_input: z.record(z.string(), z.unknown()).default({}),
  connection_id: z.string().min(1).optional(),
  schema_id: z.string().min(1).optional(),
  search_text: z.string().optional(),
  page_number: z.number().int().min(1).optional(),
  page_context: z.record(z.string(), z.unknown()).optional(),
});

export const runtime_list_tool_field_options_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-list_tool_field_options-1',
  node_name: 'list_tool_field_options',
  display_name: 'List tool field options',
  description:
    'Lists valid choices for one tool input field, using the values already chosen for other fields.',
  category: 'context',
  input_schema: {
    type: 'object',
    properties: {
      node_key: { type: 'string', description: 'Exact tool key returned by tool search.' },
      field_name: { type: 'string', description: 'Input field whose choices are needed.' },
      current_input: {
        type: 'object',
        description: 'Values already chosen for this tool.',
        additionalProperties: true,
      },
      connection_id: {
        type: 'string',
        description: 'Connected account to use when more than one is available.',
      },
      schema_id: {
        type: 'string',
        description: 'Schema ID returned by runtime-get_tool_schema-1.',
      },
      search_text: { type: 'string', description: 'Optional text used to filter the choices.' },
      page_number: { type: 'number', description: 'Optional page number, starting at 1.' },
      page_context: {
        type: 'object',
        description: 'Page context returned by the previous options call.',
        additionalProperties: true,
      },
    },
    required: ['node_key', 'field_name'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      node_key: { type: 'string' },
      schema_id: { type: ['string', 'null'] },
      field_name: { type: 'string' },
      options: { type: 'array', items: { type: 'object' } },
      next_page_context: { type: ['object', 'null'] },
    },
    required: ['node_key', 'schema_id', 'field_name', 'options', 'next_page_context'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.list_tool_field_options',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true, policy_exempt: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'runtime-list_tool_field_options-1 requires a runtime execution context.',
        },
      };
    }

    return list_tool_field_options(context.db, {
      workspace_id: context.workspace_id,
      session_id: context.session_id,
      ...(context.agent_id ? { agent_id: context.agent_id } : {}),
      actor_id: context.actor_id,
      ...(context.participants ? { participants: context.participants } : {}),
      room_private_to: context.room_private_to,
      node_key: input.node_key,
      field_name: input.field_name,
      current_input: input.current_input,
      ...(context.speaker?.source_actor_id
        ? { acting_actor_id: context.speaker.source_actor_id }
        : {}),
      ...(input.connection_id ? { connection_id: input.connection_id } : {}),
      ...(input.schema_id ? { schema_id: input.schema_id } : {}),
      ...(input.search_text ? { search_text: input.search_text } : {}),
      ...(input.page_number ? { page_number: input.page_number } : {}),
      ...(input.page_context ? { page_context: input.page_context } : {}),
    });
  },
};
