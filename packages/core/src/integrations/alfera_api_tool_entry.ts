export type UngroupedTool = {
  tool_name: string;
  display_name: string;
  description: string;
  changes_things: boolean;
  asks_by_default?: true;
};

export type GroupedTool<GroupKey extends string> = UngroupedTool & { group_key: GroupKey };

export function in_group<GroupKey extends string>(
  group_key: GroupKey,
  tools: UngroupedTool[],
): GroupedTool<GroupKey>[] {
  return tools.map((tool) => ({ ...tool, group_key }));
}

export function read(tool_name: string, display_name: string, description: string): UngroupedTool {
  return { tool_name, display_name, description, changes_things: false };
}

export function write(tool_name: string, display_name: string, description: string): UngroupedTool {
  return { tool_name, display_name, description, changes_things: true };
}

export function destructive(
  tool_name: string,
  display_name: string,
  description: string,
): UngroupedTool {
  return { ...write(tool_name, display_name, description), asks_by_default: true };
}
