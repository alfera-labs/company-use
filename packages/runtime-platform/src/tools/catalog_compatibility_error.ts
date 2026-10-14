import type { CompatibilityResult } from '@coworker/core/integrations/connection_compatibility';
import type { RuntimeToolFailure } from '@coworker/shared';

/** Explains why a resolved catalog tool cannot run with the chosen connection, or null. */
export function find_compatibility_error(input: {
  node_key: string;
  node_id: string;
  connection_id: string | null;
  compatibility: CompatibilityResult;
}): RuntimeToolFailure | null {
  if (input.compatibility.ok) return null;
  const { reason, details } = input.compatibility;
  return {
    success: false,
    error: { code: reason, message: message_for_compatibility_failure(reason, input.node_key) },
    metadata: {
      node_key: input.node_key,
      node_id: input.node_id,
      connection_id: input.connection_id,
      ...(details ?? {}),
    },
  };
}

function message_for_compatibility_failure(code: string, node_key: string) {
  const messages: Record<string, string> = {
    node_missing: `No catalog node was found for ${node_key}.`,
    node_retired: `${node_key} is retired and cannot be executed.`,
    app_not_visible: `${node_key} is not visible in this workspace.`,
    provider_config_missing: `${node_key} is missing provider configuration.`,
    connection_missing: `${node_key} requires an active compatible connection.`,
    connection_provider_mismatch: `${node_key} is not compatible with the selected provider.`,
    connection_provider_config_mismatch: `${node_key} requires a different provider config version.`,
    connection_profile_mismatch: `${node_key} requires a different connection profile.`,
    connection_missing_scopes: `${node_key} requires additional authorized scopes.`,
  };

  return messages[code] ?? `${node_key} could not be resolved for execution.`;
}
