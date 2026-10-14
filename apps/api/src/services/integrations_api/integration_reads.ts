import type { Database } from '@coworker/core';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { count_visible_nodes_by_app, list_app_nodes } from '@coworker/core/db/queries/catalog';
import {
  get_redacted_connection,
  list_redacted_connections,
} from '@coworker/core/db/queries/connection_management';
import type {
  ApprovalPolicyData,
  NodeInputSchemaData,
  NodeMetadataData,
} from '@coworker/core/db/schema/json_column_types';
import { NotFoundError } from '@coworker/shared';

export type PublicIntegration = {
  integration_key: string;
  name: string;
  kind: string;
  tool_count: number;
};

type PublicIntegrationToolParameter = {
  name: string;
  type: string;
  required: boolean;
};

export type PublicIntegrationTool = {
  name: string;
  description: string | null;
  parameters: PublicIntegrationToolParameter[];
  requires_approval: boolean;
};

const listable_connection_status = 'active';

export async function list_api_integrations(
  db: Database,
  api_key: ApiKey,
): Promise<PublicIntegration[]> {
  const connections = await list_redacted_connections(db, api_key.workspace_id);
  const active = connections.filter(
    (connection) => connection.connection_status === listable_connection_status,
  );
  const tool_counts = await count_visible_nodes_by_app(db, {
    workspace_id: api_key.workspace_id,
    app_ids: active.map((connection) => connection.app_id),
  });
  return active.map((connection) => ({
    integration_key: connection.connection_id,
    name:
      connection.connection_name ?? connection.app?.app_display_name ?? connection.connection_id,
    kind: connection.provider_key ?? 'native',
    tool_count: tool_counts.get(connection.app_id) ?? 0,
  }));
}

export async function list_api_integration_tools(
  db: Database,
  api_key: ApiKey,
  integration_key: string,
): Promise<PublicIntegrationTool[]> {
  const connection = await get_redacted_connection(db, {
    workspace_id: api_key.workspace_id,
    connection_id: integration_key,
  });
  if (!connection || connection.connection_status !== listable_connection_status) {
    throw new NotFoundError('Integration');
  }
  const tools = await list_app_nodes(db, {
    workspace_id: api_key.workspace_id,
    app_id: connection.app_id,
  });
  return tools.map((tool) => ({
    name: tool.node_key,
    description: tool_description(tool.metadata, tool.input_schema),
    parameters: tool_parameters(tool.input_schema),
    requires_approval: tool_requires_approval(tool.approval_policy),
  }));
}

function tool_requires_approval(approval_policy: ApprovalPolicyData | null | undefined): boolean {
  return approval_policy?.mode === 'manual_review';
}

function tool_description(
  metadata: NodeMetadataData | null | undefined,
  input_schema: NodeInputSchemaData | null | undefined,
): string | null {
  const from_metadata = metadata?.description;
  if (typeof from_metadata === 'string' && from_metadata.length > 0) return from_metadata;
  const from_schema = input_schema?.description;
  return typeof from_schema === 'string' && from_schema.length > 0 ? from_schema : null;
}

function tool_parameters(
  input_schema: NodeInputSchemaData | null | undefined,
): PublicIntegrationToolParameter[] {
  const properties = input_schema?.properties ?? {};
  const required = new Set(input_schema?.required ?? []);
  return Object.entries(properties)
    .filter(([, property]) => typeof property === 'object' && property !== null)
    .map(([name, property]) => ({
      name,
      type: json_schema_type(property as { type?: unknown }),
      required: required.has(name),
    }));
}

function json_schema_type(property: { type?: unknown }): string {
  const type = property.type;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.map(String).join('|');
  return 'unknown';
}
