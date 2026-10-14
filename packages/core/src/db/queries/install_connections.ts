import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { install_connections } from '@coworker/core/db/schema';
import { merge_metadata } from '@coworker/core/db/schema/common';
import type { ConnectionCredentialData } from '@coworker/core/db/schema/json_column_types';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { eq, inArray, sql } from 'drizzle-orm';

export type InstallConnectionRow = {
  connection_key: string;
  connection_status: string;
  credentials: ConnectionCredentialData;
  connection_metadata: Record<string, unknown>;
  last_checked_time: Date | null;
};

const install_connection_columns = {
  connection_key: install_connections.connection_key,
  connection_status: install_connections.connection_status,
  credentials: install_connections.credentials,
  connection_metadata: install_connections.connection_metadata,
  last_checked_time: install_connections.last_checked_time,
};

export async function save_install_connection(
  db: DatabaseExecutor,
  input: {
    connection_key: string;
    values: Record<string, string>;
    connection_metadata: Record<string, unknown>;
    actor_id: string;
  },
): Promise<void> {
  const now = new Date();
  const values = {
    connection_status: 'active',
    credentials: encrypt_connection_credentials({
      credential_source: 'manual',
      values: input.values,
    }),
    connection_metadata: input.connection_metadata,
    last_checked_time: now,
    last_updated_time: now,
    last_updated_by: input.actor_id,
  };
  await db
    .insert(install_connections)
    .values({ connection_key: input.connection_key, ...values, created_by: input.actor_id })
    .onConflictDoUpdate({
      target: install_connections.connection_key,
      set: {
        ...values,
        connection_metadata: merge_metadata(
          install_connections.connection_metadata,
          input.connection_metadata,
        ),
      },
    });
}

export function list_install_connections(
  db: DatabaseExecutor,
  connection_keys: readonly string[],
): Promise<InstallConnectionRow[]> {
  if (connection_keys.length === 0) return Promise.resolve([]);
  return db
    .select(install_connection_columns)
    .from(install_connections)
    .where(inArray(install_connections.connection_key, [...connection_keys]));
}

export async function delete_install_connection(
  db: DatabaseExecutor,
  connection_key: string,
): Promise<boolean> {
  const deleted = await db
    .delete(install_connections)
    .where(eq(install_connections.connection_key, connection_key))
    .returning({ connection_key: install_connections.connection_key });
  return deleted.length > 0;
}

export async function mark_install_connection_invalid(
  db: DatabaseExecutor,
  input: { connection_key: string; error_message: string; actor_id: string },
): Promise<void> {
  await db
    .update(install_connections)
    .set({
      connection_status: 'invalid',
      connection_metadata: sql`${install_connections.connection_metadata} || ${JSON.stringify({ error_message: input.error_message })}::jsonb`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(install_connections.connection_key, input.connection_key));
}
