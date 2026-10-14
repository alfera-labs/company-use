import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { nodes } from '@coworker/core/db/schema';
import {
  build_mcp_node_values,
  calculate_mcp_tool_list_digest,
  type McpNodeValues,
  type McpToolSeed,
} from '@coworker/core/integrations/mcp_catalog_node_values';
import { build_mcp_node_row } from '@coworker/core/integrations/mcp_catalog_rows';
import { and, eq, inArray } from 'drizzle-orm';

export type McpCatalogSyncResult = {
  inserted_tool_names: string[];
  updated_tool_names: string[];
  retired_node_keys: string[];
  unchanged_count: number;
  tool_list_digest: string;
};

export async function sync_workspace_mcp_catalog(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    app_id: string;
    app_name: string;
    server_key: string;
    auth_config?: Record<string, unknown> | undefined;
    endpoint_url: string;
    tools: readonly McpToolSeed[];
    actor_id: string;
    trust_tool_annotations?: boolean;
  },
): Promise<McpCatalogSyncResult> {
  const desired = build_mcp_node_values({
    app_name: input.app_name,
    server_key: input.server_key,
    tools: input.tools,
    trust_tool_annotations: input.trust_tool_annotations ?? false,
  });

  const existing = await db
    .select({
      node_id: nodes.node_id,
      node_name: nodes.node_name,
      node_key: nodes.node_key,
      node_status: nodes.node_status,
      node_config: nodes.node_config,
      connection_profile_key: nodes.connection_profile_key,
    })
    .from(nodes)
    .where(and(eq(nodes.app_id, input.app_id), eq(nodes.workspace_id, input.workspace_id)));

  const existing_by_name = new Map(existing.map((row) => [row.node_name, row]));
  const desired_names = new Set(desired.map((value) => value.node_name));

  const result: McpCatalogSyncResult = {
    inserted_tool_names: [],
    updated_tool_names: [],
    retired_node_keys: [],
    unchanged_count: 0,
    tool_list_digest: calculate_mcp_tool_list_digest(desired),
  };

  await db.transaction(async (tx) => {
    const rows_to_insert = [];
    for (const values of desired) {
      const current = existing_by_name.get(values.node_name);
      if (!current) {
        rows_to_insert.push(build_mcp_node_row({ ...input, values }));
        result.inserted_tool_names.push(values.tool_name);
        continue;
      }

      if (is_stored_as_wanted(current, values, read_connection_profile_key(input))) {
        result.unchanged_count += 1;
        continue;
      }

      await tx
        .update(nodes)
        .set(build_mcp_node_update(input, values))
        .where(eq(nodes.node_id, current.node_id));
      result.updated_tool_names.push(values.tool_name);
    }

    if (rows_to_insert.length > 0) await tx.insert(nodes).values(rows_to_insert);

    const vanished = existing.filter(
      (row) => !desired_names.has(row.node_name) && row.node_status !== 'retired',
    );
    if (vanished.length > 0) {
      await tx
        .update(nodes)
        .set({
          node_status: 'retired',
          discovery_status: 'hidden',
          last_updated_by: input.actor_id,
          last_updated_time: new Date(),
        })
        .where(
          inArray(
            nodes.node_id,
            vanished.map((row) => row.node_id),
          ),
        );
      result.retired_node_keys = vanished.map((row) => row.node_key);
    }
  });

  return result;
}

function build_mcp_node_update(
  input: {
    server_key: string;
    endpoint_url: string;
    auth_config?: Record<string, unknown> | undefined;
    actor_id: string;
  },
  values: McpNodeValues,
) {
  return {
    connection_profile_key: read_connection_profile_key(input),
    connection_profile_version: 1,
    node_display_name: values.node_display_name,
    input_schema: values.input_schema,
    output_schema: values.output_schema,
    approval_policy: values.approval_policy,
    runtime_handler: values.runtime_handler,
    node_status: 'active',
    discovery_status: 'visible',
    node_config: {
      sourced_from: {
        provider: 'mcp',
        provider_app_id: `mcp:${input.server_key}`,
        provider_component_id: values.tool_name,
        provider_component_version: values.tool_digest,
      },
      mcp: { endpoint_url: input.endpoint_url },
    },
    metadata: {
      source: 'mcp',
      description: values.description,
      required_connection: Boolean(input.auth_config),
    },
    last_updated_by: input.actor_id,
    last_updated_time: new Date(),
  };
}

function is_stored_as_wanted(
  stored: {
    node_status: string;
    node_config: { sourced_from?: Record<string, unknown> | undefined };
    connection_profile_key: string | null;
  },
  wanted: McpNodeValues,
  wanted_connection_profile_key: string,
): boolean {
  return (
    read_tool_digest(stored.node_config) === wanted.tool_digest &&
    stored.node_status === 'active' &&
    stored.connection_profile_key === wanted_connection_profile_key
  );
}

function read_connection_profile_key(input: {
  server_key: string;
  auth_config?: Record<string, unknown> | undefined;
}) {
  return input.auth_config
    ? `mcp:${input.server_key}:workspace_credentials`
    : `mcp:${input.server_key}:open`;
}

function read_tool_digest(node_config: { sourced_from?: Record<string, unknown> | undefined }) {
  const version = node_config?.sourced_from?.provider_component_version;
  return typeof version === 'string' ? version : null;
}

export { record_mcp_sync_outcome } from '@coworker/core/db/queries/mcp_sync_state';
