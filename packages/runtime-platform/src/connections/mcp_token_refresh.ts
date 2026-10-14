import { randomUUID } from 'node:crypto';
import type { Database } from '@coworker/core';
import { fetch_outside_address } from '@coworker/core/credentials/resolve_host_addresses';
import {
  claim_connection_token_refresh,
  release_connection_token_refresh,
} from '@coworker/core/db/queries/connection_token_refresh_lease';
import { save_refreshed_connector_token } from '@coworker/core/db/queries/connectors';
import { apps, connections } from '@coworker/core/db/schema';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import {
  create_logger,
  format_error_message,
  run_after_earlier_runs,
  sleep,
} from '@coworker/shared';
import {
  build_oauth_token_request,
  parse_oauth_token_response,
} from '@runtime-platform/connections/oauth_token_response';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const log = create_logger('mcp_token_refresh');

const expiry_margin_ms = 60 * 1000;
const token_request_timeout_ms = 15 * 1000;
const refresh_lease_seconds = 30;
const refresh_wait_ms = refresh_lease_seconds * 1000;
const refresh_retry_ms = 250;

type McpConnectionRow = typeof connections.$inferSelect;

const oauth_setup_strategy_schema = z.object({
  type: z.literal('oauth2_authorization_code'),
  token_url: z.string().url(),
  client_id: z.string().min(1),
  token_auth_method: z.string().optional(),
  resource: z.string().optional(),
});

const app_provider_configs_schema = z.object({
  provider_configs: z
    .array(
      z.object({
        provider_config_key: z.string(),
        connection_profiles: z
          .array(z.object({ connection_profile_key: z.string(), setup_strategy: z.unknown() }))
          .default([]),
      }),
    )
    .default([]),
});

/**
 * Trades an MCP connection's refresh token for a new access token when the stored one has expired,
 * or when `after_refusal` says the server just refused it. Callers in this process take turns in
 * memory, and callers in other processes meet at a short lease on the connection row, so the
 * refresh token is spent once and a later caller reuses the token the first one saved. No database
 * connection is held while the token server answers. Any failure keeps the old token, and the
 * caller reports the refusal as before.
 */
export async function renew_mcp_access_token<Row extends McpConnectionRow>(
  db: Database,
  connection: Row | null,
  options: { after_refusal?: boolean; now?: Date } = {},
): Promise<Row | null> {
  const now = options.now ?? new Date();
  if (!connection) return connection;
  if (!options.after_refusal && !token_has_expired(connection, now)) return connection;
  if (!read_connection_credential_value(connection.credentials, 'refresh_token')) {
    return connection;
  }

  try {
    return await run_after_earlier_runs(`mcp_token_refresh:${connection.connection_id}`, () =>
      renew_when_lease_is_free({
        db,
        connection,
        now,
        lease: { connection_id: connection.connection_id, lease_token: randomUUID() },
        give_up_time: Date.now() + refresh_wait_ms,
      }),
    );
  } catch (error) {
    log.warn('MCP token refresh failed', {
      connection_id: connection.connection_id,
      error: format_error_message(error),
    });
    return connection;
  }
}

type RefreshTurn<Row extends McpConnectionRow> = {
  db: Database;
  connection: Row;
  now: Date;
  lease: { connection_id: string; lease_token: string };
  give_up_time: number;
};

async function renew_when_lease_is_free<Row extends McpConnectionRow>(
  turn: RefreshTurn<Row>,
): Promise<Row> {
  const claimed = await claim_connection_token_refresh(turn.db, {
    ...turn.lease,
    lease_seconds: refresh_lease_seconds,
  });
  if (claimed) return renew_under_lease(turn, claimed);
  const [latest] = await turn.db
    .select()
    .from(connections)
    .where(eq(connections.connection_id, turn.lease.connection_id));
  if (!latest) return turn.connection;
  if (renewed_by_someone_else(turn.connection, latest)) return { ...turn.connection, ...latest };
  if (Date.now() >= turn.give_up_time) return turn.connection;
  await sleep(refresh_retry_ms);
  return renew_when_lease_is_free(turn);
}

async function renew_under_lease<Row extends McpConnectionRow>(
  turn: RefreshTurn<Row>,
  claimed: McpConnectionRow,
): Promise<Row> {
  try {
    if (renewed_by_someone_else(turn.connection, claimed))
      return { ...turn.connection, ...claimed };
    const renewed = await trade_refresh_token(turn.db, claimed, turn.now);
    return renewed ? { ...turn.connection, ...renewed } : turn.connection;
  } finally {
    await release_connection_token_refresh(turn.db, turn.lease);
  }
}

function token_has_expired(connection: McpConnectionRow, now: Date) {
  const expiry_time = connection.credential_expiry_time;
  if (!expiry_time) return false;
  return expiry_time.getTime() - expiry_margin_ms <= now.getTime();
}

function renewed_by_someone_else(seen: McpConnectionRow, locked: McpConnectionRow) {
  return (
    (locked.credential_expiry_time?.getTime() ?? null) !==
    (seen.credential_expiry_time?.getTime() ?? null)
  );
}

async function trade_refresh_token(db: Database, connection: McpConnectionRow, now: Date) {
  const refresh_token = read_connection_credential_value(connection.credentials, 'refresh_token');
  const strategy = await find_oauth_setup_strategy(db, connection);
  if (!refresh_token || !strategy) return null;

  const request = build_oauth_token_request({
    parameters: {
      grant_type: 'refresh_token',
      refresh_token,
      ...(strategy.resource ? { resource: strategy.resource } : {}),
    },
    client_id: strategy.client_id,
    client_secret: read_connection_credential_value(connection.credentials, 'oauth_client_secret'),
    token_auth_method: strategy.token_auth_method,
  });
  const response = await fetch_outside_address(strategy.token_url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(token_request_timeout_ms),
  });
  const token_response = await parse_oauth_token_response({ response });
  return save_refreshed_connector_token(db, {
    connection_id: connection.connection_id,
    existing_credentials: connection.credentials,
    values: {
      access_token: token_response.access_token,
      refresh_token: token_response.refresh_token,
    },
    expiry_time: token_response.expires_in
      ? new Date(now.getTime() + token_response.expires_in * 1000)
      : null,
  });
}

async function find_oauth_setup_strategy(db: Database, connection: McpConnectionRow) {
  const [app] = await db
    .select({ metadata: apps.metadata })
    .from(apps)
    .where(eq(apps.app_id, connection.app_id))
    .limit(1);
  const parsed = app_provider_configs_schema.safeParse(app?.metadata ?? {});
  if (!parsed.success) return null;
  const profile = parsed.data.provider_configs
    .find((config) => config.provider_config_key === connection.provider_config_key)
    ?.connection_profiles.find(
      (candidate) => candidate.connection_profile_key === connection.connection_profile_key,
    );
  const strategy = oauth_setup_strategy_schema.safeParse(profile?.setup_strategy);
  return strategy.success ? strategy.data : null;
}
