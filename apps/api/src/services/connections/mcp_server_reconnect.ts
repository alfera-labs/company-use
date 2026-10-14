import {
  assert_connection_manager,
  type ConnectionRow,
  run_user_connection_action,
  type UserConnectionAction,
} from '@api/services/connections/connection_action_guard';
import { get_connection_for_user } from '@api/services/connections/connection_reader_service';
import { reconnect_connection_as_user } from '@api/services/connections/connection_service';
import { find_why_no_request_goes_to_mcp_server } from '@api/services/connections/connection_that_cannot_work';
import { authorize_mcp_server_reading } from '@api/services/workspace_admin_access';
import type { Database } from '@coworker/core/db/connection';
import { get_visible_workspace_app } from '@coworker/core/db/queries/connection_management';
import { is_oauth_setup_strategy } from '@coworker/core/integrations/oauth_setup';
import { AppError, ValidationError } from '@coworker/shared';
import { sync_mcp_server_tools } from '@runtime-platform/connections/mcp_tool_sync';

/**
 * Reconnect, whatever the connection is. Every connection with a sign-in starts its setup
 * again, and answers with the connection and the provider that holds the setup.
 * An MCP server that has no sign-in to renew, one that takes no credential or one that takes a
 * key, has no setup to start, so the right thing is to ask the server for its tools again. That
 * proves the server still answers, and brings in tools it gained since. A server that does not
 * answer is refused with the sentence of the failure, and the failure is stored, so the
 * connection stops reading as one that works. A server that gets no request on this install is
 * refused before anything is sent or stored.
 */
export async function reconnect_connection_for_user(
  db: Database,
  input: UserConnectionAction & { redirect_uri?: string | undefined },
) {
  const mcp_server = await reconnect_mcp_server_without_sign_in(db, input);
  if (mcp_server) return { ...mcp_server, setup: {}, start_url: null };
  const connection = await reconnect_connection_as_user(db, input);
  if (!connection.provider_key) throw new ValidationError('Connection provider is missing');
  return { connection, provider_key: connection.provider_key };
}

async function reconnect_mcp_server_without_sign_in(db: Database, input: UserConnectionAction) {
  const app = await run_user_connection_action(db, input, async (transaction, connection) => {
    await assert_connection_manager(transaction, connection, input);
    return find_mcp_app_without_sign_in(transaction, connection);
  });
  if (!app) return null;

  await authorize_mcp_server_reading(db, {
    workspace_id: input.workspace_id,
    user_id: input.acting_user_id,
  });
  const no_request_goes = find_why_no_request_goes_to_mcp_server(app);
  if (no_request_goes) throw new AppError('mcp_sync_failed', no_request_goes.sentence, 422);
  const outcome = await sync_mcp_server_tools({
    db,
    workspace_id: input.workspace_id,
    app_id: app.app_id,
    actor_id: input.actor_id,
  });
  if (!outcome.synced) throw new AppError('mcp_sync_failed', outcome.because, 422);

  return {
    connection: await get_connection_for_user(db, input),
    tools_read_again: { tool_count: outcome.tool_count },
  };
}

async function find_mcp_app_without_sign_in(db: Database, connection: ConnectionRow) {
  if (connection.provider_key !== 'mcp') return null;
  const app = await get_visible_workspace_app(db, connection.workspace_id, connection.app_id);
  const profiles = (app?.metadata.provider_configs ?? [])
    .filter((config) => config.provider_key === 'mcp')
    .flatMap((config) => config.connection_profiles);
  if (!app || profiles.some((profile) => is_oauth_setup_strategy(profile.setup_strategy))) {
    return null;
  }
  if (connection.connection_status !== 'active') {
    throw new AppError(
      'mcp_server_not_connected',
      'This server is not connected. Add it again on the Integrations page, under MCP server.',
      422,
    );
  }
  return app;
}
