import type { CatalogToolResolution, CatalogToolRow } from '@coworker/core/db/queries/catalog';
import { build_api_proxy_contract } from '@runtime-platform/tools/api_proxy_contract';
import { list_tool_input_setup_steps } from '@runtime-platform/tools/tool_input_setup';

export function summarize_catalog_tool(tool: CatalogToolRow, resolution: CatalogToolResolution) {
  const requires_connection = tool_requires_connection(tool);
  const api_proxy_contract = build_api_proxy_contract(tool);
  return {
    node_key: tool.node_key,
    app_name: tool.app_name,
    node_name: tool.node_name,
    description: truncate(tool.metadata.description ?? null, 90),
    requires_connection,
    ...(requires_connection
      ? get_connection_summary(resolution)
      : { connection_status: 'not_required' }),
    approval_mode: tool.approval_policy.mode ?? 'none',
    ...(api_proxy_contract ? { api_proxy_contract } : {}),
    input_setup_steps: list_tool_input_setup_steps(tool.input_schema),
    input_fields: summarize_input_fields(tool.input_schema),
  };
}

export function summarize_api_fallback(tool: CatalogToolRow, resolution: CatalogToolResolution) {
  const requires_connection = tool_requires_connection(tool);
  const api_proxy_contract = build_api_proxy_contract(tool);
  return {
    node_key: tool.node_key,
    app_name: tool.app_name,
    node_name: tool.node_name,
    method: tool.metadata.proxy_method ?? null,
    requires_connection,
    ...(requires_connection
      ? get_connection_summary(resolution)
      : { connection_status: 'not_required' }),
    approval_mode: tool.approval_policy.mode ?? 'none',
    ...(api_proxy_contract ? { api_proxy_contract } : {}),
  };
}

export function compact_tool_summary(summary: ReturnType<typeof summarize_catalog_tool>) {
  const connection_id = 'connection_id' in summary ? summary.connection_id : undefined;
  const connection_needs_attention = ['missing', 'restricted'].includes(summary.connection_status);
  return {
    node_key: summary.node_key,
    ...(summary.requires_connection ? { requires_connection: true } : {}),
    ...(connection_id || connection_needs_attention
      ? { connection_status: summary.connection_status }
      : {}),
    ...(connection_id ? { connection_id } : {}),
    ...('api_proxy_contract' in summary ? { api_proxy_contract: summary.api_proxy_contract } : {}),
    ...(summary.input_setup_steps.length > 0
      ? { input_setup_steps: summary.input_setup_steps }
      : {}),
  };
}

function summarize_input_fields(schema: CatalogToolRow['input_schema']) {
  const properties = schema.properties;
  if (!properties) return [];
  return Object.keys(properties).map((name) => ({ name }));
}

function get_connection_summary(resolution: CatalogToolResolution) {
  if (resolution.access_denied) return { connection_status: 'restricted' };
  if (resolution.compatibility.ok) {
    return {
      connection_status: 'connected',
      ...(resolution.connection?.connection_id
        ? { connection_id: resolution.connection.connection_id }
        : {}),
    };
  }
  if (resolution.compatibility.reason === 'connection_missing') {
    return { connection_status: 'missing' };
  }
  return { connection_status: resolution.compatibility.reason };
}

function tool_requires_connection(tool: CatalogToolRow) {
  return tool.connection_profile_key !== null || tool.metadata.required_connection === true;
}

function truncate(value: string | null, maximum_length: number) {
  if (!value || value.length <= maximum_length) return value;
  return `${value.slice(0, maximum_length - 3)}...`;
}
