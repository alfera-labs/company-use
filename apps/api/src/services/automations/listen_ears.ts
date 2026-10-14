import {
  create_workspace_automation,
  set_workspace_automation_status,
} from '@api/services/automations/automation_service';
import type { Database } from '@coworker/core';
import { type Automation, list_automations } from '@coworker/core/db/queries/automation_reads';
import { upsert_default_agent_for_workspace } from '@coworker/core/db/queries/bootstrap';
import { get_redacted_connection } from '@coworker/core/db/queries/connection_management';
import { list_trigger_nodes } from '@coworker/core/db/queries/trigger_provisioning';
import { is_listen_by_default_trigger } from '@coworker/core/integrations/trigger_subject_fields';
import { create_logger, format_error_message } from '@coworker/shared';

const log = create_logger('listen_ears');

type ConnectionIdentity = { workspace_id: string; connection_id: string; actor_id: string };

const listen_automation_metadata_key = 'listen_connection_id';

export async function start_listen_ears_for_connection(db: Database, input: ConnectionIdentity) {
  try {
    return await create_listen_ears_for_connection(db, input);
  } catch (error) {
    log.error('listen ears could not be created for a connection', {
      workspace_id: input.workspace_id,
      connection_id: input.connection_id,
      error: format_error_message(error),
    });
    return null;
  }
}

export async function create_listen_ears_for_connection(
  db: Database,
  input: ConnectionIdentity,
): Promise<Automation | null> {
  const connection = await get_redacted_connection(db, input);
  if (!connection?.app || connection.connection_status !== 'active') return null;

  const existing = await find_listen_automation(db, input);
  if (existing) return wake_listen_automation(db, input, existing);

  const app_name = connection.app.app_name;
  const app_display_name = connection.app.app_display_name;
  const nodes = await list_trigger_nodes(db, {
    workspace_id: input.workspace_id,
    app_name,
    limit: 200,
  });
  const ears = nodes.filter((node) =>
    is_listen_by_default_trigger(node.node_config.composio?.trigger_slug),
  );
  if (ears.length === 0) return null;

  const written = await write_listen_automation(db, input, app_display_name, ears);
  log.info('listen ears created for a connection', {
    workspace_id: input.workspace_id,
    connection_id: input.connection_id,
    ears: ears.length,
  });
  return written.automation;
}

async function write_listen_automation(
  db: Database,
  input: ConnectionIdentity,
  app_display_name: string,
  ears: Array<{ node_key: string; node_display_name: string }>,
) {
  const agent = await upsert_default_agent_for_workspace(db, {
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
  });
  return create_workspace_automation(db, {
    workspace_id: input.workspace_id,
    agent_id: agent.agent_id,
    actor_id: input.actor_id,
    automation_name: `Listen to ${app_display_name}`,
    instruction: `Nothing to do; this ear exists so the scout can see ${app_display_name} events.`,
    triggers: ears.map((node) => ({
      kind: 'app_event' as const,
      trigger_name: node.node_display_name,
      node_key: node.node_key,
      connection_id: input.connection_id,
    })),
    run_policy: {
      subject_from: null,
      when_a_run_is_already_going: 'start_another_one',
      listen: true,
    },
    conditions: [],
    judge: null,
    created_via: 'system',
    metadata: { [listen_automation_metadata_key]: input.connection_id },
  });
}

export async function pause_listen_ears_for_connection(
  db: Database,
  input: ConnectionIdentity,
): Promise<Automation | null> {
  const existing = await find_listen_automation(db, input);
  if (!existing || existing.automation_status === 'paused') return existing;
  const moved = await set_workspace_automation_status(db, {
    workspace_id: input.workspace_id,
    automation_id: existing.automation_id,
    automation_status: 'paused',
    actor_id: input.actor_id,
  });
  return moved.automation;
}

async function wake_listen_automation(
  db: Database,
  input: ConnectionIdentity,
  existing: Automation,
): Promise<Automation> {
  if (existing.automation_status === 'enabled') return existing;
  const moved = await set_workspace_automation_status(db, {
    workspace_id: input.workspace_id,
    automation_id: existing.automation_id,
    automation_status: 'enabled',
    actor_id: input.actor_id,
  });
  return moved.automation;
}

async function find_listen_automation(
  db: Database,
  input: { workspace_id: string; connection_id: string },
): Promise<Automation | null> {
  const rows = await list_automations(db, {
    workspace_id: input.workspace_id,
    created_via: 'system',
  });
  return (
    rows.find(
      (automation) => automation.metadata[listen_automation_metadata_key] === input.connection_id,
    ) ?? null
  );
}
