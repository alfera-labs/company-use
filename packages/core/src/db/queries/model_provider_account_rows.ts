import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { apps, connections } from '@coworker/core/db/schema';
import { merge_metadata } from '@coworker/core/db/schema/common';
import type { ConnectionCredentialData } from '@coworker/core/db/schema/json_column_types';
import {
  type encrypt_connection_credentials,
  replace_connection_credential_values,
} from '@coworker/core/integrations/credential_envelope';
import {
  type ModelProviderAccountSlot,
  model_provider_account_connection_key,
  model_provider_account_slots,
} from '@coworker/core/integrations/model_provider_account_slots';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq } from 'drizzle-orm';

export type ModelProviderAccountRow = {
  connection_id: string;
  app_id: string;
  connection_status: string;
  last_checked_time: Date | null;
  metadata: Record<string, unknown>;
  credentials: ConnectionCredentialData | null;
};

export async function save_model_provider_account_row(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    provider_slot: ModelProviderAccountSlot;
    values: Record<string, string>;
    metadata: Record<string, unknown>;
    actor_id: string;
    now: Date;
  },
): Promise<void> {
  await db.transaction(async (transaction) => {
    const existing = await find_model_provider_account_row(transaction, input);
    const credentials = replace_connection_credential_values({
      existing: existing?.credentials ?? null,
      credential_source: 'manual',
      values: input.values,
      keeping_keys: [],
    });

    if (!existing) {
      await insert_model_provider_account_row(transaction, { ...input, credentials });
      return;
    }

    await transaction
      .update(connections)
      .set({
        credentials,
        connection_status: 'active',
        health_status: 'healthy',
        last_checked_time: input.now,
        metadata: merge_metadata(connections.metadata, input.metadata),
        last_updated_time: input.now,
        last_updated_by: input.actor_id,
      })
      .where(eq(connections.connection_id, existing.connection_id));
  });
}

export async function find_model_provider_account_row(
  db: DatabaseExecutor,
  input: { workspace_id: string; provider_slot: ModelProviderAccountSlot },
): Promise<ModelProviderAccountRow | undefined> {
  const [row] = await db
    .select({
      connection_id: connections.connection_id,
      app_id: connections.app_id,
      connection_status: connections.connection_status,
      last_checked_time: connections.last_checked_time,
      metadata: connections.metadata,
      credentials: connections.credentials,
    })
    .from(connections)
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_key, model_provider_account_connection_key(input.provider_slot)),
      ),
    )
    .limit(1);

  return row;
}

async function insert_model_provider_account_row(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    provider_slot: ModelProviderAccountSlot;
    actor_id: string;
    credentials: ReturnType<typeof encrypt_connection_credentials>;
    metadata: Record<string, unknown>;
    now: Date;
  },
) {
  const slot = model_provider_account_slots[input.provider_slot];
  const app_id = await find_or_create_account_app(db, input);

  await db.insert(connections).values({
    connection_id: create_id(id_prefixes.connection),
    workspace_id: input.workspace_id,
    app_id,
    connection_key: model_provider_account_connection_key(input.provider_slot),
    connection_name: `${slot.display_name} account`,
    connection_status: 'active',
    health_status: 'healthy',
    auth_method_key: 'manual_credentials',
    credentials: input.credentials,
    connection_config: {},
    connected_by: input.actor_id,
    connected_time: input.now,
    last_checked_time: input.now,
    metadata: input.metadata,
    created_by: input.actor_id,
    last_updated_by: input.actor_id,
  });
}

export async function delete_model_provider_account_rows(
  db: DatabaseExecutor,
  row: { connection_id: string; app_id: string },
) {
  await db.delete(connections).where(eq(connections.connection_id, row.connection_id));
  await db.delete(apps).where(eq(apps.app_id, row.app_id));
}

async function find_or_create_account_app(
  db: DatabaseExecutor,
  input: { workspace_id: string; provider_slot: ModelProviderAccountSlot; actor_id: string },
) {
  const slot = model_provider_account_slots[input.provider_slot];
  const [existing] = await db
    .select({ app_id: apps.app_id })
    .from(apps)
    .where(and(eq(apps.workspace_id, input.workspace_id), eq(apps.app_name, slot.app_name)))
    .limit(1);
  if (existing) return existing.app_id;

  const app_id = create_id(id_prefixes.app);
  await db.insert(apps).values({
    app_id,
    app_name: slot.app_name,
    app_key: slot.app_name,
    catalog_scope: 'workspace',
    workspace_id: input.workspace_id,
    app_display_name: `${slot.display_name} account`,
    auth_type: 'api_key',
    app_status: 'active',
    allowed_request_origins: [],
    display_config: {},
    app_config: { add_to_every_request: [] },
    metadata: {},
    created_by: input.actor_id,
    last_updated_by: input.actor_id,
  });
  return app_id;
}
