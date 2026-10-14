import type { AppMetadataData } from '@coworker/core/db/schema/json_column_types';
import type { McpNodeValues } from '@coworker/core/integrations/mcp_catalog_node_values';
import { create_id, id_prefixes } from '@coworker/shared';

export function build_workspace_mcp_app(input: {
  app_id: string;
  app_name: string;
  workspace_id: string;
  server_key: string;
  server_name: string;
  transport_config: Record<string, unknown>;
  auth_config?: Record<string, unknown>;
  setup_strategy?: Record<string, unknown>;
  icon_url?: string | undefined;
  description?: string | undefined;
  named_by_person?: boolean | undefined;
  actor_id: string;
}) {
  return {
    app_id: input.app_id,
    app_name: input.app_name,
    app_key: input.app_name,
    catalog_scope: 'workspace',
    workspace_id: input.workspace_id,
    app_display_name: input.server_name,
    app_category: 'mcp',
    auth_type: input.auth_config ? 'api_key' : 'none',
    app_status: 'active',
    display_config: {},
    metadata: {
      sourced_from: {
        provider: 'mcp',
        provider_app_id: `mcp:${input.server_key}`,
      },
      ...(input.icon_url ? { icon_url: input.icon_url } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.named_by_person ? { mcp_named_by_person: true } : {}),
      provider_configs: [build_mcp_provider_config(input)],
    },
    created_by: input.actor_id,
    last_updated_by: input.actor_id,
  };
}

/**
 * True when the tools of this MCP app look for a connection that holds a credential (a token or
 * a sign-in), and false when they look for an open one. The app is the one place that decides
 * it: a connection written for the app takes the same kind.
 */
export function mcp_app_takes_a_credential(app: { metadata: AppMetadataData }): boolean {
  return (app.metadata.provider_configs ?? []).some(
    (config) => config.provider_key === 'mcp' && config.connection_profiles.length > 0,
  );
}

function build_mcp_provider_config(input: {
  server_key: string;
  transport_config: Record<string, unknown>;
  auth_config?: Record<string, unknown>;
  setup_strategy?: Record<string, unknown>;
}) {
  return {
    provider_key: 'mcp',
    provider_config_key: `mcp:${input.server_key}:workspace`,
    version: 1,
    status: 'active',
    provider_app_key: input.server_key,
    setup_defaults: input.transport_config,
    connection_profiles: input.auth_config
      ? [
          {
            connection_profile_key: `mcp:${input.server_key}:workspace_credentials`,
            version: 1,
            status: 'active',
            auth_method_key: 'mcp_workspace_credentials',
            setup_strategy: input.setup_strategy ?? { type: 'manual_credentials' },
            runtime_credential_strategy: { type: 'encrypted_connection_credentials' },
            default_scopes: [],
          },
        ]
      : [],
  };
}

function build_mcp_node_config(input: {
  server_key: string;
  endpoint_url?: string | undefined;
  values: McpNodeValues;
}) {
  return {
    sourced_from: {
      provider: 'mcp',
      provider_app_id: `mcp:${input.server_key}`,
      provider_component_id: input.values.tool_name,
      provider_component_version: input.values.tool_digest,
    },
    ...(input.endpoint_url ? { mcp: { endpoint_url: input.endpoint_url } } : {}),
  };
}

export function build_mcp_node_row(input: {
  app_id: string;
  app_name: string;
  workspace_id: string;
  server_key: string;
  auth_config?: Record<string, unknown> | undefined;
  endpoint_url?: string | undefined;
  actor_id: string;
  values: McpNodeValues;
}) {
  const auth_required = Boolean(input.auth_config);
  return {
    node_id: create_id(id_prefixes.node),
    app_id: input.app_id,
    app_key: input.app_name,
    node_name: input.values.node_name,
    catalog_scope: 'workspace',
    workspace_id: input.workspace_id,
    node_key: input.values.node_key,
    node_version: 1,
    node_display_name: input.values.node_display_name,
    node_kind: 'tool',
    input_schema: input.values.input_schema,
    output_schema: input.values.output_schema,
    approval_policy: input.values.approval_policy,
    runtime_handler: input.values.runtime_handler,
    node_runtime: 'mcp_tool',
    node_status: 'active',
    discovery_status: 'visible',
    provider_key: 'mcp',
    provider_config_key: `mcp:${input.server_key}:workspace`,
    provider_config_version: 1,
    connection_profile_key: auth_required
      ? `mcp:${input.server_key}:workspace_credentials`
      : `mcp:${input.server_key}:open`,
    connection_profile_version: 1,
    required_scopes: [],
    required_account_properties: [],
    node_config: build_mcp_node_config(input),
    metadata: {
      source: 'mcp',
      description: input.values.description,
      required_connection: auth_required,
    },
    created_by: input.actor_id,
    last_updated_by: input.actor_id,
  };
}
