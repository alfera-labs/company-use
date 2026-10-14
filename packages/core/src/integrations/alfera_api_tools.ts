import type { ToolGroupData } from '@coworker/core/db/schema/json_column_types';
import { cloud_tool_groups, cloud_tools } from '@coworker/core/integrations/alfera_api_cloud_tools';
import {
  destructive,
  type GroupedTool,
  in_group,
  read,
  write,
} from '@coworker/core/integrations/alfera_api_tool_entry';
import { build_node_key } from '@coworker/shared';

export const alfera_api_app_name = 'alfera_api';
export const alfera_api_display_name = 'Alfera API';
export const alfera_api_connection_key = 'alfera_api';

export const built_in_connection_status = 'built_in';

export const settings_only_discovery_status = 'settings_only';

const open_tool_groups = [
  {
    group_key: 'sessions',
    title: 'Sessions',
    description: 'Start work with the coworker, follow it, and answer what it asks.',
    position: 0,
  },
  {
    group_key: 'files',
    title: 'Files',
    description: 'Read the files a session made.',
    position: 3,
  },
  {
    group_key: 'projects',
    title: 'Projects',
    description: 'Sort sessions into projects.',
    position: 4,
  },
  {
    group_key: 'skills',
    title: 'Skills',
    description: 'See the skills an agent can load.',
    position: 5,
  },
  {
    group_key: 'integrations',
    title: 'Integrations',
    description: 'See which apps the workspace has connected.',
    position: 7,
  },
  {
    group_key: 'workspace_and_agents',
    title: 'Workspace & agents',
    description: 'See and change the agents and the workspace name.',
    position: 8,
  },
  {
    group_key: 'identity',
    title: 'Identity',
    description: 'Check which key is calling and what it may do.',
    position: 9,
  },
] as const satisfies ReadonlyArray<ToolGroupData>;

export const alfera_api_tool_groups = [...open_tool_groups, ...cloud_tool_groups].sort(
  (left, right) => left.position - right.position,
);

export type AlferaApiToolGroupKey = (typeof alfera_api_tool_groups)[number]['group_key'];

export type AlferaApiTool = GroupedTool<AlferaApiToolGroupKey>;

const open_tools: AlferaApiTool[] = [
  ...in_group('sessions', [
    write('create_session', 'Create a session', 'Open a session with an agent.'),
    write('send_message', 'Send a message', 'Send the next message into a session.'),
    read('wait_for_session', 'Wait for a session', 'Wait for a session to stop working.'),
    read('get_session', 'Get a session', 'Read a session and its last reply.'),
    write('confirm_tool', 'Confirm a tool call', 'Allow or deny a tool call a session holds.'),
    write('archive_session', 'Archive a session', 'Archive a session.'),
  ]),
  ...in_group('files', [
    read('list_session_files', 'List session files', 'List the files a session produced.'),
  ]),
  ...in_group('projects', [
    write('move_session', 'Move a session', 'Move a session into a project.'),
  ]),
  ...in_group('skills', [read('list_skills', 'List skills', 'List the skills an agent can load.')]),
  ...in_group('integrations', [
    read('list_integrations', 'List integrations', 'List the connected apps.'),
  ]),
  ...in_group('workspace_and_agents', [
    read('list_agents', 'List agents', 'List the workspace agents.'),
    destructive('update_agent', 'Update an agent', "Rewrite an agent's name or instructions."),
    destructive('rename_workspace', 'Rename the workspace', 'Rename the workspace.'),
  ]),
  ...in_group('identity', [
    read('whoami', 'Who am I', 'Report which key is calling and what it may do.'),
  ]),
];

export const alfera_api_tools: readonly AlferaApiTool[] = [...open_tools, ...cloud_tools].sort(
  (left, right) =>
    find_tool_group(left.group_key).position - find_tool_group(right.group_key).position,
);

export function build_alfera_api_node_key(tool_name: string) {
  return build_node_key({ app_name: alfera_api_app_name, node_name: tool_name, node_version: 1 });
}

export function find_alfera_api_tool(tool_name: string) {
  return alfera_api_tools.find((tool) => tool.tool_name === tool_name) ?? null;
}

export function build_alfera_api_tool_group(group_key: AlferaApiToolGroupKey): ToolGroupData {
  return { ...find_tool_group(group_key) };
}

function find_tool_group(group_key: AlferaApiToolGroupKey): ToolGroupData {
  const found = alfera_api_tool_groups.find((entry) => entry.group_key === group_key);
  if (!found) throw new Error(`Unknown Alfera API tool group: ${group_key}`);
  return found;
}

export function alfera_api_tool_policy_labels(tool: AlferaApiTool) {
  return tool.changes_things ? ['changes_things'] : [];
}
