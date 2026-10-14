import {
  type AppCredentialRule,
  read_api_protocol_headers_from_exchange_method,
} from '@coworker/core/credentials/app_credential_config';
import type { CredentialExchangeMethod } from '@coworker/core/credentials/credential_exchange';
import type { Database } from '@coworker/core/db/connection';
import { apps, connections } from '@coworker/core/db/schema';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { model_provider_account_app_names } from '@coworker/core/integrations/model_provider_account_slots';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, isNull, notInArray } from 'drizzle-orm';
import { z } from 'zod';

const allowed_hosts_schema = z.array(z.string());

export type WorkspaceCredentialSummary = {
  connection_id: string;
  connection_name: string | null;
  app_display_name: string;
  connection_status: string;
  health_status: string;
  allowed_hosts: readonly string[];
};

type InsertWorkspaceCredentialInput = {
  workspace_id: string;
  created_by: string;
  display_name: string;
  allowed_hosts: readonly string[];
  secret_values: Readonly<Record<string, string>>;
  icon_url?: string | undefined;
  add_to_every_request?: readonly AppCredentialRule[] | undefined;
  exchange_the_credential_by?: CredentialExchangeMethod | undefined;
};

export async function list_workspace_credentials(
  db: Database,
  workspace_id: string,
): Promise<WorkspaceCredentialSummary[]> {
  const rows = await db
    .select({
      connection_id: connections.connection_id,
      connection_name: connections.connection_name,
      app_display_name: apps.app_display_name,
      connection_status: connections.connection_status,
      health_status: connections.health_status,
      allowed_hosts: apps.allowed_request_origins,
    })
    .from(connections)
    .innerJoin(apps, eq(connections.app_id, apps.app_id))
    .where(
      and(
        eq(connections.workspace_id, workspace_id),
        isNull(connections.revoked_time),
        notInArray(apps.app_name, [...model_provider_account_app_names]),
      ),
    );

  return rows.map((row) => ({
    ...row,
    allowed_hosts: allowed_hosts_schema.parse(row.allowed_hosts),
  }));
}

export async function insert_workspace_credential(
  db: Database,
  input: InsertWorkspaceCredentialInput,
): Promise<{ connection_id: string; app_id: string }> {
  const app_id = create_id(id_prefixes.app);
  const connection_id = create_id(id_prefixes.connection);
  const app_name = `workspace_credential_${app_id}`;
  const rules = input.add_to_every_request ?? [];

  return db.transaction(async (transaction) => {
    await transaction.insert(apps).values({
      app_id,
      app_name,
      app_key: app_name,
      catalog_scope: 'workspace',
      workspace_id: input.workspace_id,
      app_display_name: input.display_name,
      auth_type: 'api_key',
      app_status: 'active',
      allowed_request_origins: input.allowed_hosts,
      display_config: input.icon_url ? { icon_url: input.icon_url } : {},
      app_config: {
        add_to_every_request: rules,
        ...(input.exchange_the_credential_by
          ? {
              api_protocol_headers: read_api_protocol_headers_from_exchange_method(
                input.exchange_the_credential_by,
              ),
              exchange_the_credential_by: input.exchange_the_credential_by,
            }
          : {}),
      },
      metadata: {},
      created_by: input.created_by,
      last_updated_by: input.created_by,
    });
    await transaction.insert(connections).values({
      connection_id,
      workspace_id: input.workspace_id,
      app_id,
      connection_key: `workspace_credential:${connection_id}`,
      connection_name: input.display_name,
      connection_status: 'active',
      auth_method_key: 'manual_credentials',
      credentials: encrypt_connection_credentials({
        credential_source: 'manual',
        values: { ...input.secret_values },
      }),
      connection_config: { credential_delivery_mode: 'attached_at_egress' },
      connected_by: input.created_by,
      connected_time: new Date(),
      metadata: {},
      created_by: input.created_by,
      last_updated_by: input.created_by,
    });
    return { connection_id, app_id };
  });
}

export async function disable_workspace_credential(
  db: Database,
  input: { workspace_id: string; connection_id: string },
): Promise<void> {
  await db
    .update(connections)
    .set({
      revoked_time: new Date(),
      last_updated_time: new Date(),
      last_updated_by: 'system',
    })
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_id, input.connection_id),
      ),
    );
}
