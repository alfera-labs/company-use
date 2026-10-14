import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import {
  model_config_without_credential,
  type RuntimeModelConfig,
} from '@agent-core/models/runtime_model_config';
import type { RuntimeToolDefinition } from '@agent-core/tools/runtime_tool';
import {
  create_context_management,
  type SessionContextManagement,
} from '@runtime-platform/orchestrator/context/context_management';
import {
  create_capability_manifest_packet,
  create_environment_packet,
  type SessionContextPacket,
} from '@runtime-platform/orchestrator/context/context_packets';
import { estimate_context_tokens_roughly } from '@runtime-platform/orchestrator/context/token_estimation';

export function create_model_context_snapshot(input: {
  run_key?: string;
  session_key?: string;
  system_prompt: string;
  context_summary?: string | null;
  context_packets?: SessionContextPacket[];
  context_management?: SessionContextManagement;
  selection_policy?: Record<string, unknown>;
  model: RuntimeModelConfig;
  messages: RuntimeAgentMessage[];
  tools: RuntimeToolDefinition[];
  environment_context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const tools = input.tools.map(serialize_tool_definition_for_snapshot);
  const model = model_config_without_credential(input.model);
  const context_management =
    input.context_management ??
    create_context_management(input.context_summary ?? null, undefined, null);
  const metadata = {
    ...input.metadata,
    context_management,
  };
  const context_packets = [
    ...(input.context_packets ?? []),
    create_capability_manifest_packet(tools),
    ...(input.environment_context === undefined
      ? []
      : [create_environment_packet(input.environment_context)]),
  ];
  const engine_input = {
    ...(input.run_key === undefined ? {} : { run_key: input.run_key }),
    ...(input.session_key === undefined ? {} : { session_key: input.session_key }),
    system_prompt: input.system_prompt,
    model,
    messages: input.messages,
    tools,
    metadata,
    signal: {
      omitted_from_snapshot: true,
      reason: 'AbortSignal is runtime process state, not model-visible context.',
    },
  };
  const snapshot = {
    snapshot_schema_version: 1,
    system_prompt: input.system_prompt,
    context_summary: input.context_summary ?? null,
    context_management,
    context_packets,
    selection_policy: input.selection_policy ?? {},
    model,
    messages: input.messages,
    tools,
    metadata,
    engine_input,
  };

  return {
    snapshot,
    message_count: input.messages.length,
    tool_count: tools.length,
    token_estimate: estimate_context_tokens_roughly({
      system_prompt: input.system_prompt,
      messages: input.messages,
      tools,
    }),
  };
}

function serialize_tool_definition_for_snapshot(tool: RuntimeToolDefinition) {
  const { execute: _execute, ...serializable_tool } = tool;
  return serializable_tool;
}
