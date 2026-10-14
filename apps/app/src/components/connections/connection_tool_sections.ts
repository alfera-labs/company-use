import {
  type ConnectionToolPolicyView,
  get_group_policy_change,
  get_tool_policy_change,
  type PolicyChange,
  type ToolGroupId,
  type ToolPolicyView,
  tool_groups,
} from '@/components/connections/connection_tool_policy_state';
import type { ConnectionTool, ToolPolicyMode } from '@/lib/api/types';

type SectionTool = ConnectionToolPolicyView & Pick<ConnectionTool, 'tool_group'>;

export type ToolSection<T extends SectionTool> = {
  section_key: string;
  label: string;
  description: string | null;
  policy_group: ToolGroupId | null;
  tools: T[];
};

export function build_tool_sections<T extends SectionTool>(tools: T[]): ToolSection<T>[] {
  if (tools.length > 0 && tools.every((tool) => tool.tool_group))
    return build_family_sections(tools);
  return tool_groups.map((group) => ({
    section_key: group.group_id,
    label: group.label,
    description: null,
    policy_group: group.group_id,
    tools: tools.filter((tool) => tool.policy_group === group.group_id),
  }));
}

export function get_section_policy_change<T extends SectionTool>(
  section: ToolSection<T>,
  tools: T[],
  policies: ToolPolicyView[],
  mode: ToolPolicyMode,
): PolicyChange {
  if (section.policy_group)
    return get_group_policy_change(section.policy_group, tools, policies, mode);
  const changes = section.tools.map((tool) => get_tool_policy_change(tool, policies, mode));
  return {
    delete_policy_ids: changes.flatMap((change) => change.delete_policy_ids),
    set_policies: changes.flatMap((change) => change.set_policies),
  };
}

function build_family_sections<T extends SectionTool>(tools: T[]): ToolSection<T>[] {
  const sections = new Map<string, ToolSection<T> & { position: number }>();
  for (const tool of tools) {
    if (!tool.tool_group) continue;
    const { group_key, title, description, position } = tool.tool_group;
    const section = sections.get(group_key) ?? {
      section_key: group_key,
      label: title,
      description,
      policy_group: null,
      tools: [],
      position,
    };
    section.tools.push(tool);
    sections.set(group_key, section);
  }
  return [...sections.values()]
    .sort((left, right) => left.position - right.position)
    .map(({ position: _position, ...section }) => section);
}
