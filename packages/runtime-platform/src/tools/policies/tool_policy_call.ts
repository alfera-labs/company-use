import type { RuntimeToolDefinition } from '@agent-core/tools/runtime_tool';
import type { Database } from '@coworker/core';
import type { Participants } from '@coworker/core/access/may_use_resource';
import { resolve_catalog_tool } from '@coworker/core/db/queries/catalog';
import type {
  ApprovalPolicyData,
  NodeMetadataData,
} from '@coworker/core/db/schema/json_column_types';
import { find_tool_by_node_key } from '@runtime-platform/tools/tool_registry';
import type { RuntimeToolSourceContext } from '@runtime-platform/tools/types';
import { z } from 'zod';

export type ModelToolCall = {
  tool_call_id: string;
  tool_name: string;
  input: unknown;
};

export type FindRunTool = (tool_name: string) => RuntimeToolDefinition | undefined;

export type ToolPolicyCallTarget = {
  tool_call_id: string;
  called_tool_name: string;
  node_key: string;
  tool_input: unknown;
  connection_id: string | null;
  approval_policy: ApprovalPolicyData | null;
  metadata: NodeMetadataData | null;
};

export type ToolPolicyCallContext = {
  workspace_id: string;
  acting_actor_id?: string | undefined;
  participants?: Participants | undefined;
  room_private_to?: string | null | undefined;
  source_context?: RuntimeToolSourceContext | undefined;
};

export type ToolPolicyCallTargets = {
  targets: ToolPolicyCallTarget[];
  unknown_tool_names: string[];
};

export async function read_tool_policy_call_targets(
  db: Database,
  context: ToolPolicyCallContext,
  calls: readonly ModelToolCall[],
  find_run_tool?: FindRunTool,
): Promise<ToolPolicyCallTargets> {
  const resolved = await Promise.all(
    calls.map((call) => read_tool_policy_call_target(db, context, call, find_run_tool)),
  );
  return {
    targets: resolved.flatMap((target) => (target ? [target] : [])),
    unknown_tool_names: calls
      .filter((_call, index) => !resolved[index])
      .map((call) => call.tool_name),
  };
}

async function read_tool_policy_call_target(
  db: Database,
  context: ToolPolicyCallContext,
  call: ModelToolCall,
  find_run_tool: FindRunTool | undefined,
): Promise<ToolPolicyCallTarget | null> {
  const platform_tool = find_tool_by_node_key(call.tool_name);
  if (!platform_tool) return read_run_tool_target(find_run_tool?.(call.tool_name), call);

  const carried = read_carried_call(platform_tool.metadata, call.input);
  const node_key = carried?.node_key ?? call.tool_name;
  const declared = carried ? find_tool_by_node_key(node_key) : platform_tool;
  const tool_input = read_input_as_it_will_run(node_key, carried?.tool_input ?? call.input);
  const requested_connection_id = read_requested_connection_id(call.input);
  const resolved = await resolve_catalog_tool(db, {
    workspace_id: context.workspace_id,
    node_key,
    ...(requested_connection_id ? { connection_id: requested_connection_id } : {}),
    ...(context.participants ? { participants: context.participants } : {}),
    room_private_to: context.room_private_to,
  });

  return {
    tool_call_id: call.tool_call_id,
    called_tool_name: call.tool_name,
    node_key,
    tool_input,
    connection_id: declared?.find_policy_connection_id
      ? await declared.find_policy_connection_id(db, { ...context, tool_input })
      : read_connection_id(context, platform_tool.app_name, resolved),
    approval_policy: resolved.tool?.approval_policy ?? declared?.approval_policy ?? null,
    metadata: read_target_metadata(resolved.tool?.metadata, declared?.metadata),
  };
}

function read_target_metadata(
  stored: unknown,
  declared: NodeMetadataData | undefined,
): NodeMetadataData | null {
  const metadata = (stored as NodeMetadataData | undefined) ?? declared ?? null;
  if (!metadata || !declared) return metadata;
  return {
    ...metadata,
    ...(declared.policy_exempt === true ? { policy_exempt: true } : {}),
    ...(metadata.approval_display_fields || !declared.approval_display_fields
      ? {}
      : { approval_display_fields: declared.approval_display_fields }),
  };
}

function read_run_tool_target(
  run_tool: RuntimeToolDefinition | undefined,
  call: ModelToolCall,
): ToolPolicyCallTarget | null {
  if (!run_tool) return null;
  const metadata = (run_tool.metadata ?? {}) as NodeMetadataData;
  return {
    tool_call_id: call.tool_call_id,
    called_tool_name: call.tool_name,
    node_key: call.tool_name,
    tool_input: call.input,
    connection_id: null,
    approval_policy: (metadata.approval_policy as ApprovalPolicyData | undefined) ?? null,
    metadata: label_what_this_tool_does(metadata),
  };
}

function label_what_this_tool_does(metadata: NodeMetadataData): NodeMetadataData {
  if (metadata.policy_labels || declares_read_only(metadata)) return metadata;
  return { ...metadata, policy_labels: ['changes_things'] };
}

const read_only_declaration = z.object({ risk_class: z.literal('read') });

function declares_read_only(metadata: NodeMetadataData) {
  return read_only_declaration.safeParse(metadata.policy).success;
}

export function read_input_as_it_will_run(node_key: string, tool_input: unknown) {
  const tool = find_tool_by_node_key(node_key);
  if (!tool) return tool_input;
  try {
    return tool.validate_input.parse(tool_input);
  } catch {
    return tool_input;
  }
}

function read_carried_call(metadata: NodeMetadataData | undefined, input: unknown) {
  const fields = metadata?.policy_target_reads_input_fields;
  if (!fields) return null;
  const envelope = transport_envelope.safeParse(input);
  if (!envelope.success) return null;

  const node_key = envelope.data[fields.node_key];
  if (typeof node_key !== 'string' || node_key.length === 0) return null;

  return { node_key, tool_input: envelope.data[fields.tool_input] ?? {} };
}

function read_requested_connection_id(input: unknown) {
  const envelope = transport_envelope.safeParse(input);
  if (!envelope.success) return undefined;
  const connection_id = envelope.data.connection_id;
  return typeof connection_id === 'string' && connection_id.length > 0 ? connection_id : undefined;
}

function read_connection_id(
  context: ToolPolicyCallContext,
  app_name: string,
  resolved: Awaited<ReturnType<typeof resolve_catalog_tool>>,
) {
  const source_connection_id = context.source_context?.source_metadata?.slack?.connection_id;
  if (source_connection_id && app_name === 'slack') return source_connection_id;
  return resolved.connection?.connection_id ?? null;
}

const transport_envelope = z.record(z.string(), z.unknown());
