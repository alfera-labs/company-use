import type {
  ApiProtocolHeaders,
  AppCredentialRule,
} from '@coworker/core/credentials/app_credential_config';
import type { CredentialExchangeState } from '@coworker/core/credentials/credential_exchange_state';
import { write_credential_exchange_state } from '@coworker/core/credentials/credential_exchange_state';
import { exchanged_value_prefix } from '@coworker/core/credentials/exchanged_credential_delivery';
import type { Database } from '@coworker/core/db/connection';
import { apps, connections } from '@coworker/core/db/schema';
import type {
  AppConfigData,
  ConnectionConfigData,
  ConnectionCredentialData,
} from '@coworker/core/db/schema/json_column_types';
import { add_connection_credential_values } from '@coworker/core/integrations/credential_envelope';
import { and, eq, isNull, sql } from 'drizzle-orm';

export type ConnectionAwaitingExchange = {
  connection_id: string;
  app_id: string;
  credentials: ConnectionCredentialData | null;
  connection_config: ConnectionConfigData;
  app_config: AppConfigData;
  allowed_hosts: readonly string[];
};

export async function find_connection_awaiting_exchange(
  db: Database,
  input: { workspace_id: string; connection_id: string },
): Promise<ConnectionAwaitingExchange | null> {
  const [row] = await db
    .select({
      connection_id: connections.connection_id,
      app_id: connections.app_id,
      credentials: connections.credentials,
      connection_config: connections.connection_config,
      app_config: apps.app_config,
      allowed_hosts: apps.allowed_request_origins,
    })
    .from(connections)
    .innerJoin(apps, eq(connections.app_id, apps.app_id))
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_id, input.connection_id),
        isNull(connections.revoked_time),
      ),
    )
    .limit(1);

  if (!row) return null;
  return {
    ...row,
    allowed_hosts: row.allowed_hosts,
  };
}

export async function save_exchanged_credential(
  db: Database,
  input: {
    connection: ConnectionAwaitingExchange;
    exchanged_values: Record<string, string>;
    delivery_rules: readonly AppCredentialRule[];
    api_protocol_headers: ApiProtocolHeaders;
    expiry_time: Date | null;
    state: CredentialExchangeState;
  },
): Promise<void> {
  const now = new Date();
  await db.transaction(async (transaction) => {
    await transaction
      .update(connections)
      .set({
        credentials: add_connection_credential_values({
          existing: input.connection.credentials,
          credential_source: 'credential_exchange',
          values: input.exchanged_values,
          replacing_keys_prefixed_with: exchanged_value_prefix,
        }),
        credential_expiry_time: input.expiry_time,
        connection_config: write_credential_exchange_state(
          input.connection.connection_config,
          input.state,
        ),
        health_status: 'healthy',
        last_checked_time: now,
        last_updated_time: now,
        last_updated_by: 'system',
      })
      .where(eq(connections.connection_id, input.connection.connection_id));

    await transaction
      .update(apps)
      .set({
        app_config: {
          ...input.connection.app_config,
          add_to_every_request: input.delivery_rules,
          api_protocol_headers: input.api_protocol_headers,
        },
        last_updated_time: now,
        last_updated_by: 'system',
      })
      .where(eq(apps.app_id, input.connection.app_id));
  });
}

export async function record_failed_credential_exchange(
  db: Database,
  input: { connection: ConnectionAwaitingExchange; state: CredentialExchangeState },
): Promise<void> {
  const now = new Date();
  await db
    .update(connections)
    .set({
      connection_config: write_credential_exchange_state(
        input.connection.connection_config,
        input.state,
      ),
      health_status: 'unhealthy',
      last_checked_time: now,
      last_updated_time: now,
      last_updated_by: 'system',
    })
    .where(eq(connections.connection_id, input.connection.connection_id));
}

export type ConnectionServingHost = {
  connection_id: string;
  delivers_to_host: boolean;
  can_sign_in: boolean;
};

export async function find_connections_serving_host(
  db: Database,
  input: { workspace_id: string; host: string },
): Promise<ConnectionServingHost[]> {
  const host_rule = JSON.stringify([{ when_the_request_goes_to: input.host }]);
  const rows = await db
    .select({
      connection_id: connections.connection_id,
      delivers_to_host: sql<boolean>`coalesce(${apps.app_config}->'add_to_every_request', '[]'::jsonb) @> ${host_rule}::jsonb`,
      can_sign_in: sql<boolean>`${apps.app_config} ? 'exchange_the_credential_by'`,
    })
    .from(connections)
    .innerJoin(apps, eq(connections.app_id, apps.app_id))
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_status, 'active'),
        isNull(connections.revoked_time),
        sql`${apps.allowed_request_origins} @> ${JSON.stringify([input.host])}::jsonb`,
      ),
    );

  return rows.map((row) => ({
    connection_id: row.connection_id,
    delivers_to_host: Boolean(row.delivers_to_host),
    can_sign_in: Boolean(row.can_sign_in),
  }));
}
