import type {
  AgentConfigData,
  AgentEnabledNodeData,
  ConnectionSelectorData,
} from '@coworker/core/db/schema/json_column_types';

export type AgentEnabledNode = AgentEnabledNodeData;
export type ConnectionSelector = ConnectionSelectorData;

export function parse_agent_enabled_nodes(agent_config: AgentConfigData): AgentEnabledNode[] {
  return (agent_config.enabled_nodes ?? []).filter(
    (node): node is AgentEnabledNode => typeof node === 'object',
  );
}

export function write_agent_enabled_nodes(
  agent_config: AgentConfigData,
  enabled_nodes: AgentEnabledNode[],
) {
  return {
    ...agent_config,
    enabled_nodes,
  };
}
