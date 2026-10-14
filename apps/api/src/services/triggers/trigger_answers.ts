import {
  create_workspace_trigger,
  list_workspace_triggers,
  update_workspace_trigger,
} from '@api/services/triggers/trigger_service';
import type { Database } from '@coworker/core';
import { hide_trigger_webhook_secret } from '@runtime-platform/triggers/trigger_webhook_secret';

/**
 * The trigger rows a route may answer with: what the service holds, minus any stored secret. A
 * route reads these and never the service's own rows, which carry the secret of a web-call
 * trigger made before secrets were hashed and the signing secret a provider gave.
 */
export async function list_triggers_without_secrets(db: Database, workspace_id: string) {
  const triggers = await list_workspace_triggers(db, workspace_id);
  return triggers.map(hide_trigger_webhook_secret);
}

export async function create_trigger_without_secrets(
  ...service_input: Parameters<typeof create_workspace_trigger>
) {
  return hide_trigger_webhook_secret(await create_workspace_trigger(...service_input));
}

export async function update_trigger_without_secrets(
  ...service_input: Parameters<typeof update_workspace_trigger>
) {
  return hide_trigger_webhook_secret(await update_workspace_trigger(...service_input));
}
