import { execute_catalog_tool } from '@runtime-platform/tools/catalog_tool_execution';
import { room_of_parent_call } from '@runtime-platform/tools/nested_tool_call_room';
import { project_tool_output } from '@runtime-platform/tools/tool_output_projection';
import type {
  RuntimeToolDefinition,
  RuntimeToolExecutionContext,
} from '@runtime-platform/tools/types';
import { z } from 'zod';

const catalog_tool_timeout_ms = 120_000;

const input_schema = z.object({
  node_key: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  connection_id: z.string().min(1).optional(),
  schema_id: z.string().min(1).optional(),
  dynamic_props_id: z.string().min(1).optional(),
  stash_id: z.string().min(1).optional(),
  output_fields: z.array(z.string().min(1)).min(1).max(20).optional(),
});

export const runtime_execute_tool_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-execute_tool-1',
  node_name: 'execute_tool',
  display_name: 'Execute tool',
  description:
    'Executes one catalog tool by node_key once runtime-search_tools-1 has identified the exact tool and its input shape is known (from the schema the search inlined, or from runtime-get_tool_schema-1). For large list/search results, request only the output_fields needed for the next step.',
  category: 'actions',
  input_schema: {
    type: 'object',
    properties: {
      node_key: {
        type: 'string',
        description: 'Exact catalog node key returned by search, e.g. gmail-find_email-1.',
      },
      input: {
        type: 'object',
        description:
          'Input object that matches the target tool schema from runtime-get_tool_schema-1.',
        additionalProperties: true,
      },
      connection_id: {
        type: 'string',
        description:
          'Use the connection id selected by runtime-search_tools-1. Omit it to use that same default account; choose another only when the user identifies it.',
      },
      dynamic_props_id: {
        type: 'string',
        description: 'Legacy provider schema ID. Prefer schema_id.',
      },
      schema_id: {
        type: 'string',
        description: 'Schema ID returned by runtime-get_tool_schema-1.',
      },
      stash_id: {
        type: 'string',
        description: 'Optional file stash id for multi-step file workflows.',
      },
      output_fields: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 20,
        description:
          'For large list/search results, fields to keep on each returned item, e.g. ["id", "sender", "subject"]. The full provider result remains available in diagnostics.',
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
      output: {
        type: 'object',
        additionalProperties: true,
      },
    },
    required: ['node_key', 'app_name', 'node_name', 'output'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.execute_tool',
  approval_policy: { mode: 'none' },
  policy_timeout_ms: () => catalog_tool_timeout_ms,
  source_context_policy: { mode: 'current_turn' },
  metadata: {
    safe_for_first_milestone: true,
    policy_exempt: true,
    policy_delegates_to_catalog: true,
    policy_target_reads_input_fields: { node_key: 'node_key', tool_input: 'input' },
  },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'runtime-execute_tool-1 requires a runtime execution context.',
        },
      };
    }

    const schema_id = input.schema_id ?? input.dynamic_props_id;
    const platform_result = await run_platform_tool_found_by_search(
      input.node_key,
      input.input,
      context,
    );
    const result =
      platform_result ??
      (await execute_catalog_tool(context.db, {
        workspace_id: context.workspace_id,
        session_id: context.session_id,
        run_id: context.run_id,
        ...(context.agent_id ? { agent_id: context.agent_id } : {}),
        actor_id: context.actor_id,
        ...(context.participants ? { participants: context.participants } : {}),
        room_private_to: context.room_private_to,
        ...(context.speaker?.source_actor_id
          ? { acting_actor_id: context.speaker.source_actor_id }
          : {}),
        node_key: input.node_key,
        tool_input: input.input,
        ...(context.environment ? { environment: context.environment } : {}),
        ...(context.source_context ? { source_context: context.source_context } : {}),
        ...(context.signal ? { signal: context.signal } : {}),
        ...(input.connection_id ? { connection_id: input.connection_id } : {}),
        ...(schema_id ? { dynamic_props_id: schema_id } : {}),
        ...(input.stash_id ? { stash_id: input.stash_id } : {}),
      }));

    if (!result.success || !input.output_fields) return result;
    return {
      ...result,
      model_visible_data: project_tool_output(result.data, input.output_fields),
      metadata: {
        ...(result.metadata ?? {}),
        output_projection: { fields: input.output_fields },
      },
    };
  },
};

async function run_platform_tool_found_by_search(
  node_key: string,
  tool_input: Record<string, unknown>,
  context: RuntimeToolExecutionContext,
) {
  const [{ execute_runtime_tool }, { find_tool_by_node_key }] = await Promise.all([
    import('@runtime-platform/tools/tool_execution_service'),
    import('@runtime-platform/tools/tool_registry'),
  ]);
  if (!find_tool_by_node_key(node_key)) return null;
  const { result } = await execute_runtime_tool(context.db, {
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    run_id: context.run_id,
    ...(context.agent_id ? { agent_id: context.agent_id } : {}),
    actor_id: context.actor_id,
    node_key,
    tool_input,
    ...(context.environment ? { environment: context.environment } : {}),
    ...(context.attachment_sources ? { attachment_sources: context.attachment_sources } : {}),
    ...(context.source_context ? { source_context: context.source_context } : {}),
    ...(context.speaker ? { speaker: context.speaker } : {}),
    ...(context.participants ? { participants: context.participants } : {}),
    ...room_of_parent_call(context),
    ...(context.signal ? { signal: context.signal } : {}),
    tool_result_is_model_visible: false,
  });
  return result;
}
