import type { ConnectionSelector } from '@coworker/core/integrations/agent_enabled_nodes';

type CompatibilityFailureReason =
  | 'node_missing'
  | 'node_retired'
  | 'app_not_visible'
  | 'provider_config_missing'
  | 'connection_missing'
  | 'connection_provider_mismatch'
  | 'connection_provider_config_mismatch'
  | 'connection_profile_mismatch'
  | 'connection_missing_scopes';

export type CompatibilityResult =
  | { ok: true }
  | { ok: false; reason: CompatibilityFailureReason; details?: Record<string, unknown> };

type CompatibleNode = {
  app_id: string;
  node_status: string;
  provider_key: string | null;
  provider_config_key: string | null;
  provider_config_version: number | null;
  connection_profile_key: string | null;
  connection_profile_version: number | null;
  required_scopes: string[];
};

type CompatibleConnection = {
  app_id: string;
  connection_status: string;
  health_status?: string | null;
  provider_key?: string | null;
  provider_config_key?: string | null;
  provider_config_version?: number | null;
  connection_profile_key?: string | null;
  connection_profile_version?: number | null;
  authorized_scopes?: string[];
};

export function validate_node_execution_compatibility(
  node: CompatibleNode | null,
  connection: CompatibleConnection | null,
  selector: ConnectionSelector,
): CompatibilityResult {
  if (!node) return { ok: false, reason: 'node_missing' };
  if (node.node_status === 'retired') return { ok: false, reason: 'node_retired' };

  const connection_not_required =
    selector.strategy === 'no_connection_required' || node.connection_profile_key === null;
  if (connection_not_required) return { ok: true };

  if (!node.provider_key || !node.provider_config_key || !node.provider_config_version) {
    return { ok: false, reason: 'provider_config_missing' };
  }

  if (!connection || connection.connection_status !== 'active') {
    return { ok: false, reason: 'connection_missing' };
  }

  if (connection.health_status === 'unhealthy') {
    return { ok: false, reason: 'connection_missing' };
  }

  if (connection.app_id !== node.app_id || connection.provider_key !== node.provider_key) {
    return { ok: false, reason: 'connection_provider_mismatch' };
  }

  if (
    connection.provider_config_key !== node.provider_config_key ||
    connection.provider_config_version !== node.provider_config_version
  ) {
    return { ok: false, reason: 'connection_provider_config_mismatch' };
  }

  if (
    connection.connection_profile_key !== node.connection_profile_key ||
    connection.connection_profile_version !== node.connection_profile_version
  ) {
    return { ok: false, reason: 'connection_profile_mismatch' };
  }

  const missing_scopes = find_missing_scopes(node.required_scopes, connection.authorized_scopes);
  if (missing_scopes.length > 0) {
    return {
      ok: false,
      reason: 'connection_missing_scopes',
      details: { missing_scopes },
    };
  }

  return { ok: true };
}

export function find_missing_scopes(required_scopes: string[], authorized_scopes: string[] = []) {
  const required_scope_set = new Set(required_scopes);
  const authorized_scope_set = new Set(authorized_scopes);
  return [...required_scope_set].filter((scope) => !authorized_scope_set.has(scope));
}
