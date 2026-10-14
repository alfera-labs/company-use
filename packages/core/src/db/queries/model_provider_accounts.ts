import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import {
  delete_model_provider_account_rows,
  find_model_provider_account_row,
  save_model_provider_account_row,
} from '@coworker/core/db/queries/model_provider_account_rows';
import { apps, connections } from '@coworker/core/db/schema';
import type { ConnectionCredentialData } from '@coworker/core/db/schema/json_column_types';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import {
  find_model_provider_account_slot_by_app_name,
  type ModelProviderAccountSlot,
  model_provider_account_app_names,
  model_provider_account_slots,
} from '@coworker/core/integrations/model_provider_account_slots';
import { AppError, format_error_message } from '@coworker/shared';
import { and, eq, inArray } from 'drizzle-orm';

type ModelProviderCredentialStatus = 'active' | 'invalid';

export type ModelProviderAccount = {
  provider_slot: ModelProviderAccountSlot;
  display_name: string;
  secret_hint: string;
  credential_status: ModelProviderCredentialStatus;
  last_validated_time: Date | null;
  error_message: string | null;
};

export async function upsert_model_provider_account(
  db: Database,
  input: {
    workspace_id: string;
    provider_slot: ModelProviderAccountSlot;
    api_key: string;
    actor_id: string;
  },
): Promise<ModelProviderAccount> {
  const env_name = model_provider_account_slots[input.provider_slot].env_name;
  const now = new Date();
  const metadata = { secret_hint: input.api_key.slice(-4), error_message: null };

  await save_model_provider_account_row(db, {
    ...input,
    values: { [env_name]: input.api_key },
    metadata,
    now,
  });

  return {
    provider_slot: input.provider_slot,
    display_name: model_provider_account_slots[input.provider_slot].display_name,
    secret_hint: metadata.secret_hint,
    credential_status: 'active',
    last_validated_time: now,
    error_message: null,
  };
}

export async function list_model_provider_accounts(
  db: Database,
  workspace_id: string,
): Promise<ModelProviderAccount[]> {
  const rows = await db
    .select({
      app_name: apps.app_name,
      connection_status: connections.connection_status,
      last_checked_time: connections.last_checked_time,
      metadata: connections.metadata,
    })
    .from(connections)
    .innerJoin(apps, eq(connections.app_id, apps.app_id))
    .where(
      and(
        eq(connections.workspace_id, workspace_id),
        inArray(apps.app_name, [...model_provider_account_app_names]),
      ),
    );

  return rows.flatMap((row) => {
    const provider_slot = find_model_provider_account_slot_by_app_name(row.app_name);
    if (!provider_slot) return [];
    return [
      {
        provider_slot,
        display_name: model_provider_account_slots[provider_slot].display_name,
        secret_hint: read_metadata_text(row.metadata, 'secret_hint') ?? '',
        credential_status: row.connection_status === 'active' ? 'active' : 'invalid',
        last_validated_time: row.last_checked_time,
        error_message: read_metadata_text(row.metadata, 'error_message'),
      } satisfies ModelProviderAccount,
    ];
  });
}

export async function read_model_provider_account_values(
  db: Database,
  workspace_id: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ app_name: apps.app_name, credentials: connections.credentials })
    .from(connections)
    .innerJoin(apps, eq(connections.app_id, apps.app_id))
    .where(
      and(
        eq(connections.workspace_id, workspace_id),
        eq(connections.connection_status, 'active'),
        inArray(apps.app_name, [...model_provider_account_app_names]),
      ),
    );

  return Object.fromEntries(
    rows.flatMap((row) => {
      const provider_slot = find_model_provider_account_slot_by_app_name(row.app_name);
      if (!provider_slot) return [];
      const slot = model_provider_account_slots[provider_slot];
      return [slot.env_name, ...slot.shared_value_names].flatMap((value_name) => {
        const value = decrypt_account_value(row.credentials, value_name, provider_slot);
        return value === null ? [] : [[value_name, value] as const];
      });
    }),
  );
}

export async function delete_model_provider_account(
  db: Database,
  input: { workspace_id: string; provider_slot: ModelProviderAccountSlot },
): Promise<boolean> {
  return db.transaction(async (transaction) => {
    const existing = await find_model_provider_account_row(transaction, input);
    if (!existing) return false;

    await delete_model_provider_account_rows(transaction, existing);
    return true;
  });
}

export async function mark_model_provider_account_invalid(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    provider_slot: ModelProviderAccountSlot;
    error_message: string;
    actor_id: string;
  },
): Promise<void> {
  const existing = await find_model_provider_account_row(db, input);
  if (!existing) return;

  await db
    .update(connections)
    .set({
      connection_status: 'invalid',
      health_status: 'unhealthy',
      metadata: { ...existing.metadata, error_message: input.error_message },
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(connections.connection_id, existing.connection_id));
}

function decrypt_account_value(
  credentials: ConnectionCredentialData | null,
  env_name: string,
  provider_slot: ModelProviderAccountSlot,
) {
  try {
    return read_connection_credential_value(credentials, env_name);
  } catch (error) {
    throw new AppError(
      'workspace_model_key_unreadable',
      `The stored ${provider_slot} API key could not be decrypted.`,
      500,
      { provider_slot, cause: format_error_message(error) },
    );
  }
}

function read_metadata_text(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value ? value : null;
}
