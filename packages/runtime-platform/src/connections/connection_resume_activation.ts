import { apps, type Database } from '@coworker/core';
import {
  finalize_oauth_connection,
  finalize_provider_connection,
} from '@coworker/core/db/queries/connection_management';
import type { ConnectionSetupStateData } from '@coworker/core/db/schema/json_column_types';
import { create_logger, format_error_message } from '@coworker/shared';
import { enqueue_connection_resume } from '@runtime-platform/events/connection_resume_job';
import { enqueue_mcp_tool_sync } from '@runtime-platform/events/mcp_tool_sync_job';
import { hand_waiting_sources_to_connection } from '@runtime-platform/memory_host/source_connection_handoff';
import { eq } from 'drizzle-orm';

const log = create_logger('connection_resume');

type FinalizeOAuthConnectionInput = Parameters<typeof finalize_oauth_connection>[1];
type FinalizeProviderConnectionInput = Parameters<typeof finalize_provider_connection>[1];

export async function finalize_oauth_connection_with_resume(
  db: Database,
  input: FinalizeOAuthConnectionInput & { setup_state: ConnectionSetupStateData },
) {
  const { setup_state, ...finalize_input } = input;
  const connection = await finalize_oauth_connection(db, finalize_input);
  if (finalize_input.status === 'success') {
    await start_connection_resume(db, {
      workspace_id: finalize_input.workspace_id,
      connection_id: connection.connection_id,
      actor_id: finalize_input.actor_id,
      setup_state,
    });
    await start_mcp_tool_sync_if_mcp_server(db, {
      workspace_id: finalize_input.workspace_id,
      app_id: connection.app_id,
      actor_id: finalize_input.actor_id,
    });
    await hand_waiting_sources_to_new_connection(db, {
      workspace_id: finalize_input.workspace_id,
      connection_id: connection.connection_id,
      actor_id: finalize_input.actor_id,
    });
  }
  return connection;
}

export async function finalize_provider_connection_with_resume(
  db: Database,
  input: FinalizeProviderConnectionInput & { setup_state: ConnectionSetupStateData },
) {
  const { setup_state, ...finalize_input } = input;
  const connection = await finalize_provider_connection(db, finalize_input);
  if (finalize_input.status === 'success') {
    await start_connection_resume(db, {
      workspace_id: finalize_input.workspace_id,
      connection_id: finalize_input.connection_id,
      actor_id: finalize_input.actor_id,
      setup_state,
    });
    await start_mcp_tool_sync_if_mcp_server(db, {
      workspace_id: finalize_input.workspace_id,
      app_id: connection.app_id,
      actor_id: finalize_input.actor_id,
    });
    await hand_waiting_sources_to_new_connection(db, {
      workspace_id: finalize_input.workspace_id,
      connection_id: connection.connection_id,
      actor_id: finalize_input.actor_id,
    });
  }
  return connection;
}

async function hand_waiting_sources_to_new_connection(
  db: Database,
  input: { workspace_id: string; connection_id: string; actor_id: string },
) {
  try {
    return await hand_waiting_sources_to_connection(db, input);
  } catch (error) {
    log.error('Handing waiting sources to the new connection failed', {
      workspace_id: input.workspace_id,
      connection_id: input.connection_id,
      error: format_error_message(error),
    });
    return { moved_source_ids: [] };
  }
}

async function start_mcp_tool_sync_if_mcp_server(
  db: Database,
  input: { workspace_id: string; app_id: string; actor_id: string },
) {
  try {
    const app = await db.query.apps.findFirst({ where: eq(apps.app_id, input.app_id) });
    if (app?.app_category !== 'mcp') return { enqueued: false, reason: 'not_an_mcp_server' };
    return await enqueue_mcp_tool_sync(db, input);
  } catch (error) {
    log.error('MCP tool sync enqueue failed', {
      workspace_id: input.workspace_id,
      app_id: input.app_id,
      error: format_error_message(error),
    });
    return { enqueued: false, reason: 'mcp_tool_sync_enqueue_failed' };
  }
}

export async function start_resumes_for_expired_connection_setups(
  db: Database,
  expired_connections: Array<{
    workspace_id: string;
    connection_id: string;
    last_updated_by: string;
    setup_state_before_expiry: ConnectionSetupStateData;
  }>,
) {
  const results = [];
  for (const connection of expired_connections) {
    if (!connection.setup_state_before_expiry.resume) continue;
    results.push(
      await start_connection_resume(db, {
        workspace_id: connection.workspace_id,
        connection_id: connection.connection_id,
        actor_id: connection.last_updated_by,
        setup_state: connection.setup_state_before_expiry,
        resolution: 'expired',
      }),
    );
  }
  return results;
}

export async function start_connection_resume(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    actor_id: string;
    setup_state: ConnectionSetupStateData;
    resolution?: 'connected' | 'postponed' | 'cancelled' | 'expired';
  },
) {
  try {
    return await enqueue_connection_resume(db, input);
  } catch (error) {
    log.error('Resume enqueue failed', {
      workspace_id: input.workspace_id,
      connection_id: input.connection_id,
      error: format_error_message(error),
    });
    return { enqueued: false, reason: 'connection_resume_enqueue_failed' };
  }
}
