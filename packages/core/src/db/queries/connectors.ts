import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { connections } from '@coworker/core/db/schema';
import { connector_health } from '@coworker/core/db/schema/connectors';
import type { ConnectionCredentialData } from '@coworker/core/db/schema/json_column_types';
import { add_connection_credential_values } from '@coworker/core/integrations/credential_envelope';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, sql } from 'drizzle-orm';

export async function get_workspace_connection_for_connector(
  db: Database,
  input: { workspace_id: string; connection_id: string },
) {
  return (
    (await db.query.connections.findFirst({
      where: and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_id, input.connection_id),
        eq(connections.connection_status, 'active'),
      ),
    })) ?? null
  );
}

export async function find_connection_for_composio_connected_account(
  db: Database,
  connected_account_id: string,
) {
  return (
    (await db.query.connections.findFirst({
      where: and(
        eq(connections.connection_status, 'active'),
        sql`${connections.provider_account} ->> 'connected_account_id' = ${connected_account_id}`,
      ),
    })) ?? null
  );
}

export async function find_first_active_connection_for_app(db: Database, app_key: string) {
  return (
    (await db.query.connections.findFirst({
      where: and(
        eq(connections.connection_status, 'active'),
        eq(connections.provider_key, 'native'),
        eq(connections.provider_config_key, `native:${app_key}`),
      ),
      orderBy: (table, { asc }) => [asc(table.created_time)],
    })) ?? null
  );
}

export const connector_token_refresh_actor = 'system:connector_token_refresh';

// The tokens a refresh produced, written onto the connection they belong to.
//
// Merged, not replaced: a provider that keeps the same refresh token across refreshes returns
// only a new access token, and replacing the envelope would throw away the one value the next
// refresh needs. The row is returned so the caller runs the provider call on what was stored.
export async function save_refreshed_connector_token(
  db: DatabaseExecutor,
  input: {
    connection_id: string;
    existing_credentials: ConnectionCredentialData | null;
    values: Record<string, string | undefined>;
    expiry_time: Date | null;
  },
) {
  const now = new Date();
  const [row] = await db
    .update(connections)
    .set({
      credentials: add_connection_credential_values({
        existing: input.existing_credentials,
        credential_source: 'oauth2',
        values: input.values,
      }),
      credential_expiry_time: input.expiry_time,
      health_status: 'healthy',
      last_checked_time: now,
      last_updated_time: now,
      last_updated_by: connector_token_refresh_actor,
    })
    .where(eq(connections.connection_id, input.connection_id))
    .returning();
  return row ?? null;
}

export type ConnectorHealthObservation = {
  app_key: string;
  node_key: string;
  ok: boolean;
  latency_ms: number;
  error_code?: string | null;
  checked_time?: Date;
};

const connector_health_actor = 'system:connector_canary';

export async function record_connector_health(
  db: Database,
  observations: readonly ConnectorHealthObservation[],
) {
  if (observations.length === 0) return [];
  return db
    .insert(connector_health)
    .values(
      observations.map((observation) => ({
        connector_health_id: create_id(id_prefixes.connector_health),
        app_key: observation.app_key,
        node_key: observation.node_key,
        checked_time: observation.checked_time ?? new Date(),
        ok: observation.ok,
        latency_ms: observation.latency_ms,
        error_code: observation.ok ? null : (observation.error_code ?? 'unknown_error'),
        created_by: connector_health_actor,
        last_updated_by: connector_health_actor,
      })),
    )
    .returning();
}
