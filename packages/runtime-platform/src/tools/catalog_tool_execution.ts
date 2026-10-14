import type { Database } from '@coworker/core';
import { resolve_catalog_tool } from '@coworker/core/db/queries/catalog';
import type { RuntimeToolResult } from '@coworker/shared';
import { find_compatibility_error } from '@runtime-platform/tools/catalog_compatibility_error';
import { find_catalog_tool_executor } from '@runtime-platform/tools/catalog_tool_executors';
import type {
  CatalogTool,
  ExecuteCatalogToolInput,
} from '@runtime-platform/tools/catalog_tool_types';
import { describe_connection_not_shared } from '@runtime-platform/tools/connection_not_shared_message';
import { find_gmail_send_through_api_proxy_error } from '@runtime-platform/tools/gmail_send_through_api_proxy';
import { find_dead_signature_error } from '@runtime-platform/tools/policies/delegated_authority_signer';
import { find_scout_catalog_action_error } from '@runtime-platform/tools/policies/scout_action';
import { evaluate_tool_policy_gate } from '@runtime-platform/tools/policies/tool_policy_gate';
import { system_run_has_human_authority } from '@runtime-platform/tools/system_run_authority';
import { tool_input_needs_schema_id } from '@runtime-platform/tools/tool_input_setup';

export async function execute_catalog_tool(
  db: Database,
  input: ExecuteCatalogToolInput,
): Promise<RuntimeToolResult> {
  const resolved_tool = await resolve_catalog_tool(db, {
    workspace_id: input.workspace_id,
    node_key: input.node_key,
    ...(input.connection_id ? { connection_id: input.connection_id } : {}),
    ...(input.participants ? { participants: input.participants } : {}),
    room_private_to: input.room_private_to,
  });
  if (!resolved_tool.tool) {
    return tool_error('node_missing', node_missing_message(input.node_key), {
      node_key: input.node_key,
      connection_id: input.connection_id ?? null,
    });
  }
  if (resolved_tool.access_denied) {
    return tool_error('access_denied', describe_connection_not_shared(resolved_tool.tool), {
      node_key: input.node_key,
    });
  }
  const tool = resolved_tool.tool;
  const connection = resolved_tool.connection;

  const refusal =
    find_compatibility_error({
      node_key: input.node_key,
      node_id: tool.node_id,
      connection_id: connection?.connection_id ?? input.connection_id ?? null,
      compatibility: resolved_tool.compatibility,
    }) ?? find_gmail_send_through_api_proxy_error(tool, input.tool_input);
  if (refusal) return with_catalog_tool_reference(refusal, tool);

  const policy_gate = await evaluate_tool_policy_gate(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    ...(input.agent_id ? { agent_id: input.agent_id } : {}),
    actor_id: input.actor_id,
    ...(input.acting_actor_id ? { acting_actor_id: input.acting_actor_id } : {}),
    node_key: input.node_key,
    tool_input: input.tool_input,
    connection_id: connection?.connection_id ?? null,
    approval_policy: tool.approval_policy,
    metadata: tool.metadata,
    ...(input.source_context ? { source_context: input.source_context } : {}),
  });
  if (policy_gate.error) return with_catalog_tool_reference(policy_gate.error, tool);

  if (tool_input_needs_schema_id(tool.input_schema) && !input.dynamic_props_id) {
    return with_catalog_tool_reference(
      tool_error(
        'tool_schema_required',
        `${input.node_key} has input fields that change based on earlier choices. Call runtime-get_tool_schema-1 with current_input, then retry with the returned schema_id.`,
        {
          node_key: input.node_key,
          required_tool: 'runtime-get_tool_schema-1',
          required_input: 'schema_id',
          retryable: true,
        },
      ),
      tool,
    );
  }

  const scout_error = await find_scout_catalog_action_error({
    db,
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
    node_key: input.node_key,
    tool_input: input.tool_input,
    source_context: input.source_context,
  });
  if (scout_error) return with_catalog_tool_reference(scout_error, tool);

  if (
    input.actor_id.startsWith('system:') &&
    requires_manual_approval(tool) &&
    !policy_gate.approval_granted
  ) {
    if (!system_run_has_human_authority(input)) {
      return with_catalog_tool_reference(
        tool_error(
          'approval_required',
          `${input.node_key} changes something outside the workspace, and this run has no human authority for it, so it did not run and nothing is waiting for approval. Do not try another tool or the browser to do the same thing. Tell the person it was not done: a request they make themselves in the chat carries that authority.`,
          { node_key: input.node_key, actor_id: input.actor_id },
        ),
        tool,
      );
    }
    const dead_signature = await find_dead_signature_error(db, {
      node_key: input.node_key,
      source_metadata: input.source_context?.source_metadata,
    });
    if (dead_signature) return with_catalog_tool_reference(dead_signature, tool);
  }

  const execute = find_catalog_tool_executor(tool.runtime_handler);
  if (!execute) {
    return with_catalog_tool_reference(
      tool_error(
        'unsupported_catalog_tool',
        `${input.node_key} is not backed by a supported catalog runtime handler.`,
        { runtime_handler: tool.runtime_handler },
      ),
      tool,
    );
  }

  return with_catalog_tool_reference(await execute(db, input, tool, connection), tool);
}

function with_catalog_tool_reference(result: RuntimeToolResult, tool: CatalogTool) {
  const sourced_from = tool.node_config?.sourced_from ?? null;
  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      node_id: tool.node_id,
      node_version: tool.node_version,
      node_provenance: sourced_from,
    },
  };
}

function requires_manual_approval(tool: CatalogTool) {
  return tool.approval_policy.mode === 'manual_review';
}

const node_key_shape = /^[\w-]+$/u;

export function node_missing_message(node_key: string) {
  if (node_key_shape.test(node_key)) {
    return `No catalog node was found for ${node_key}.`;
  }
  const [candidate] = node_key.split(/[^\w-]/u, 1);
  const suggestion =
    candidate && node_key_shape.test(candidate) ? ` Did you mean ${candidate}?` : '';
  return `node_key is not a valid node identifier: it must be exactly the key, like gmail-find_email-1, with no other syntax, quotes, or arguments inside it.${suggestion} Send node_key and input as separate arguments of this tool call.`;
}

function tool_error(
  code: string,
  message: string,
  metadata?: Record<string, unknown>,
): RuntimeToolResult {
  return {
    success: false,
    error: { code, message },
    ...(metadata ? { metadata } : {}),
  };
}
