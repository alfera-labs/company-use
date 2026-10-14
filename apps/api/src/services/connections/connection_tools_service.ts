import type { Database } from '@coworker/core';
import {
  build_tool_policy_resources,
  get_tool_policy_group,
} from '@coworker/core/access/tool_policy_resources';
import { list_app_nodes } from '@coworker/core/db/queries/catalog';
import { get_redacted_connection } from '@coworker/core/db/queries/connection_management';
import { NotFoundError } from '@coworker/shared';
import { z } from 'zod';

const tool_group_schema = z
  .object({
    group_key: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    position: z.number().int(),
  })
  .strict();

export async function list_connection_tools_for_user(
  db: Database,
  input: { workspace_id: string; connection_id: string; acting_user_id: string },
) {
  const connection = await get_redacted_connection(db, input);
  if (!connection) throw new NotFoundError('Connection');

  const tools = await list_app_nodes(db, {
    workspace_id: input.workspace_id,
    app_id: connection.app_id,
  });
  return tools.map((tool) => {
    const resources = build_tool_policy_resources(tool);
    return {
      ...tool,
      policy_group: get_tool_policy_group(tool),
      tool_group: read_tool_group(tool.metadata),
      policy_label_ids: resources
        .filter((resource) => resource.resource_type === 'node_label')
        .sort((left, right) => right.specificity - left.specificity)
        .map((resource) => resource.resource_id),
    };
  });
}

function read_tool_group(metadata: { tool_group?: unknown } | null) {
  if (metadata?.tool_group === undefined) return null;
  return tool_group_schema.parse(metadata.tool_group);
}
