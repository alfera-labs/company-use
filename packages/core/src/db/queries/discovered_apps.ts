import { read_api_protocol_headers_from_exchange_method } from '@coworker/core/credentials/app_credential_config';
import type { CredentialExchangeMethod } from '@coworker/core/credentials/credential_exchange';
import type { Database } from '@coworker/core/db/connection';
import { apps, connections } from '@coworker/core/db/schema';
import type { ConnectionSetupStateData } from '@coworker/core/db/schema/json_column_types';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

export type AppAwaitingCredentials = {
  app_id: string;
  connection_id: string;
  app_display_name: string;
  logo_url: string | null;
  sign_in_name_label: string;
  could_not_determine: string[];
};

type InsertDiscoveredAppInput = {
  workspace_id: string;
  created_by: string;
  app_display_name: string;
  allowed_hosts: readonly string[];
  logo_url?: string | undefined;
  exchange_the_credential_by: CredentialExchangeMethod;
  sign_in_name_label: string;
  could_not_determine: readonly string[];
};

export async function insert_discovered_app(
  db: Database,
  input: InsertDiscoveredAppInput,
): Promise<{ app_id: string; connection_id: string }> {
  const app_id = create_id(id_prefixes.app);
  const connection_id = create_id(id_prefixes.connection);
  const app_name = `discovered_app_${app_id}`;

  return db.transaction(async (transaction) => {
    await transaction.insert(apps).values({
      app_id,
      app_name,
      app_key: app_name,
      catalog_scope: 'workspace',
      workspace_id: input.workspace_id,
      app_display_name: input.app_display_name,
      auth_type: 'api_key',
      app_status: 'active',
      allowed_request_origins: input.allowed_hosts,
      app_config: {
        add_to_every_request: [],
        api_protocol_headers: read_api_protocol_headers_from_exchange_method(
          input.exchange_the_credential_by,
        ),
        exchange_the_credential_by: input.exchange_the_credential_by,
      },
      display_config: {
        ...(input.logo_url ? { icon_url: input.logo_url } : {}),
        sign_in_name_label: input.sign_in_name_label,
        could_not_determine: input.could_not_determine,
        worked_out_by: 'agent_discovery',
      },
      metadata: {},
      created_by: input.created_by,
      last_updated_by: input.created_by,
    });
    await transaction.insert(connections).values({
      connection_id,
      workspace_id: input.workspace_id,
      app_id,
      connection_key: `discovered_app:${connection_id}`,
      connection_name: input.app_display_name,
      connection_status: 'pending_setup',
      auth_method_key: 'manual_credentials',
      connection_config: { credential_delivery_mode: 'attached_at_egress' },
      metadata: {},
      created_by: input.created_by,
      last_updated_by: input.created_by,
    });
    return { app_id, connection_id };
  });
}

export async function find_app_awaiting_credentials(
  db: Database,
  input: { workspace_id: string; website_host: string },
): Promise<AppAwaitingCredentials | null> {
  const [row] = await db
    .select({
      app_id: apps.app_id,
      connection_id: connections.connection_id,
      app_display_name: apps.app_display_name,
      display_config: apps.display_config,
    })
    .from(connections)
    .innerJoin(apps, eq(connections.app_id, apps.app_id))
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_status, 'pending_setup'),
        isNull(connections.revoked_time),
        sql`${apps.allowed_request_origins} @> ${JSON.stringify([input.website_host])}::jsonb`,
      ),
    )
    .limit(1);

  if (!row) return null;
  const display = (row.display_config ?? {}) as Record<string, unknown>;
  return {
    app_id: row.app_id,
    connection_id: row.connection_id,
    app_display_name: row.app_display_name,
    logo_url: typeof display.icon_url === 'string' ? display.icon_url : null,
    sign_in_name_label:
      typeof display.sign_in_name_label === 'string' ? display.sign_in_name_label : 'Email',
    could_not_determine: Array.isArray(display.could_not_determine)
      ? display.could_not_determine.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

export type AppSetupRow = AppAwaitingCredentials & {
  allowed_hosts: string[];
  app_config: unknown;
  setup_state: ConnectionSetupStateData;
};

export async function find_app_setup_by_connection(
  db: Database,
  input: { workspace_id: string; connection_id: string },
): Promise<AppSetupRow | null> {
  const [row] = await db
    .select({
      app_id: apps.app_id,
      connection_id: connections.connection_id,
      app_display_name: apps.app_display_name,
      display_config: apps.display_config,
      allowed_hosts: apps.allowed_request_origins,
      app_config: apps.app_config,
      setup_state: connections.setup_state,
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
  const display = (row.display_config ?? {}) as Record<string, unknown>;
  return {
    app_id: row.app_id,
    connection_id: row.connection_id,
    app_display_name: row.app_display_name,
    logo_url: typeof display.icon_url === 'string' ? display.icon_url : null,
    sign_in_name_label:
      typeof display.sign_in_name_label === 'string' ? display.sign_in_name_label : 'Email',
    could_not_determine: Array.isArray(display.could_not_determine)
      ? display.could_not_determine.filter((entry): entry is string => typeof entry === 'string')
      : [],
    allowed_hosts: Array.isArray(row.allowed_hosts) ? (row.allowed_hosts as string[]) : [],
    app_config: row.app_config,
    setup_state: row.setup_state,
  };
}

export async function save_credentials_for_setup(
  db: Database,
  input: { connection_id: string; actor_id: string; values: Record<string, string> },
): Promise<void> {
  const now = new Date();
  await db
    .update(connections)
    .set({
      credentials: encrypt_connection_credentials({
        credential_source: 'manual',
        values: input.values,
      }),
      connection_status: 'active',
      connected_by: input.actor_id,
      connected_time: now,
      last_updated_time: now,
      last_updated_by: input.actor_id,
    })
    .where(eq(connections.connection_id, input.connection_id));
}
