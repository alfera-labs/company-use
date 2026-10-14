import type { ConnectionTool, ToolPolicy, ToolPolicyMode } from '@/lib/api/types';

export type ConnectionToolPolicyView = Pick<
  ConnectionTool,
  'node_key' | 'node_name' | 'node_display_name' | 'policy_group' | 'policy_label_ids'
>;
export type ToolPolicyView = Pick<
  ToolPolicy,
  'policy_id' | 'resource_type' | 'resource_id' | 'policy_mode'
>;
export type ToolGroupId = ConnectionTool['policy_group'];
export type ToolGroupMode = ToolPolicyMode | 'custom';
export type ToolPreset = ToolPolicyMode | 'ask_for_writes' | 'read_only' | 'custom';

export const preset_label_modes = {
  allow: [{ resource_id: 'every_tool', policy_mode: 'allow' }],
  ask: [{ resource_id: 'every_tool', policy_mode: 'ask' }],
  never: [{ resource_id: 'every_tool', policy_mode: 'never' }],
  ask_for_writes: [
    { resource_id: 'every_tool', policy_mode: 'allow' },
    { resource_id: 'changes_things', policy_mode: 'ask' },
  ],
  read_only: [
    { resource_id: 'only_reads', policy_mode: 'allow' },
    { resource_id: 'changes_things', policy_mode: 'never' },
    { resource_id: 'emails_outsiders', policy_mode: 'never' },
  ],
} as const satisfies Record<
  Exclude<ToolPreset, 'custom'>,
  ReadonlyArray<{ resource_id: string; policy_mode: ToolPolicyMode }>
>;

export const tool_groups = [
  { group_id: 'only_reads', label: 'Read-only tools' },
  { group_id: 'changes_things', label: 'Write/delete tools' },
] as const satisfies ReadonlyArray<{ group_id: ToolGroupId; label: string }>;

export const tool_presets = [
  { value: 'allow', label: 'Always allow', detail: 'Run every tool without asking.' },
  { value: 'ask', label: 'Ask each time', detail: 'Ask before every tool call.' },
  {
    value: 'ask_for_writes',
    label: 'Ask for writes/deletes',
    detail: 'Ask before tools that change data.',
  },
  { value: 'never', label: 'Never allow', detail: 'Block every tool for this connection.' },
  { value: 'custom', label: 'Custom', detail: 'Use separate rules for each tool.' },
] as const satisfies ReadonlyArray<{ value: ToolPreset; label: string; detail: string }>;

type PolicyWrite = {
  resource_type: string;
  resource_id: string;
  policy_mode: ToolPolicyMode;
};

export type PolicyChange = {
  delete_policy_ids: string[];
  set_policies: PolicyWrite[];
};

export function filter_connection_tools<T extends ConnectionToolPolicyView>(
  tools: T[],
  query: string,
) {
  const normalized_query = query.trim().toLowerCase();
  if (!normalized_query) return tools;
  return tools.filter((tool) =>
    [tool.node_display_name, tool.node_name, tool.node_key].some((value) =>
      value.toLowerCase().includes(normalized_query),
    ),
  );
}

export function get_tool_mode(
  tool: ConnectionToolPolicyView,
  policies: ToolPolicyView[],
): ToolPolicyMode {
  const exact_policy = get_exact_policy(tool, policies);
  return exact_policy ? read_policy_mode(exact_policy) : get_tool_inherited_mode(tool, policies);
}

function get_tool_inherited_mode(
  tool: ConnectionToolPolicyView,
  policies: ToolPolicyView[],
): ToolPolicyMode {
  for (const label_id of tool.policy_label_ids) {
    const label_policy = get_label_policy(label_id, policies);
    if (label_policy) return read_policy_mode(label_policy);
  }
  return 'allow';
}

export function get_group_mode(
  tools: ConnectionToolPolicyView[],
  policies: ToolPolicyView[],
): ToolGroupMode {
  const modes = new Set(tools.map((tool) => get_tool_mode(tool, policies)));
  return modes.size === 1 ? ([...modes][0] ?? 'custom') : 'custom';
}

export function get_connection_preset(
  tools: ConnectionToolPolicyView[],
  policies: ToolPolicyView[],
): ToolPreset {
  if (tools.length === 0) return 'custom';
  const modes = tools.map((tool) => get_tool_mode(tool, policies));
  if (modes.every((mode) => mode === 'allow')) return 'allow';
  if (modes.every((mode) => mode === 'ask')) return 'ask';
  if (modes.every((mode) => mode === 'never')) return 'never';

  const read_tools = tools.filter((tool) => tool.policy_group === 'only_reads');
  const write_tools = tools.filter((tool) => tool.policy_group === 'changes_things');
  if (
    read_tools.length > 0 &&
    write_tools.length > 0 &&
    read_tools.every((tool) => get_tool_mode(tool, policies) === 'allow') &&
    write_tools.every((tool) => get_tool_mode(tool, policies) === 'ask')
  ) {
    return 'ask_for_writes';
  }
  return 'custom';
}

export function get_tool_policy_change(
  tool: ConnectionToolPolicyView,
  policies: ToolPolicyView[],
  mode: ToolPolicyMode,
): PolicyChange {
  const exact_policy = get_exact_policy(tool, policies);
  const inherits_selected_mode = get_tool_inherited_mode(tool, policies) === mode;
  return {
    delete_policy_ids: exact_policy ? [exact_policy.policy_id] : [],
    set_policies: inherits_selected_mode
      ? []
      : [{ resource_type: 'node', resource_id: tool.node_key, policy_mode: mode }],
  };
}

export function get_group_policy_change(
  group_id: ToolGroupId,
  tools: ConnectionToolPolicyView[],
  policies: ToolPolicyView[],
  mode: ToolPolicyMode,
): PolicyChange {
  const tool_keys = new Set(
    tools.filter((tool) => tool.policy_group === group_id).map((tool) => tool.node_key),
  );
  const group_labels = new Set(
    group_id === 'changes_things' ? ['changes_things', 'emails_outsiders'] : ['only_reads'],
  );
  return {
    delete_policy_ids: policies
      .filter(
        (policy) =>
          (policy.resource_type === 'node' && tool_keys.has(policy.resource_id)) ||
          (policy.resource_type === 'node_label' && group_labels.has(policy.resource_id)),
      )
      .map((policy) => policy.policy_id),
    set_policies: [{ resource_type: 'node_label', resource_id: group_id, policy_mode: mode }],
  };
}

export function get_preset_policy_change(
  policies: ToolPolicyView[],
  preset: Exclude<ToolPreset, 'custom'>,
): PolicyChange {
  return {
    delete_policy_ids: policies
      .filter((policy) => policy.resource_type === 'node' || policy.resource_type === 'node_label')
      .map((policy) => policy.policy_id),
    set_policies: preset_label_modes[preset].map((policy) => ({
      resource_type: 'node_label',
      ...policy,
    })),
  };
}

function get_exact_policy(tool: ConnectionToolPolicyView, policies: ToolPolicyView[]) {
  return policies.find(
    (policy) => policy.resource_type === 'node' && policy.resource_id === tool.node_key,
  );
}

function get_label_policy(resource_id: string, policies: ToolPolicyView[]) {
  return policies.find(
    (policy) => policy.resource_type === 'node_label' && policy.resource_id === resource_id,
  );
}

function read_policy_mode(policy: ToolPolicyView): ToolPolicyMode {
  if (
    policy.policy_mode === 'allow' ||
    policy.policy_mode === 'ask' ||
    policy.policy_mode === 'never'
  ) {
    return policy.policy_mode;
  }
  throw new Error(`Invalid tool policy mode: ${policy.policy_mode}`);
}
