import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { connections, install_connections } from '@coworker/core/db/schema';
import { merge_metadata } from '@coworker/core/db/schema/common';
import { read_connection_credential_values } from '@coworker/core/integrations/credential_envelope';
import {
  type ModelProviderAccountSlot,
  model_provider_account_connection_key,
} from '@coworker/core/integrations/model_provider_account_slots';
import { type AnyColumn, and, eq, type SQL, sql } from 'drizzle-orm';

type WorkspaceAccount = { workspace_id: string; provider_slot: ModelProviderAccountSlot };
type RenewalClaim = { claimed_until: Date; actor_id: string };

const renewal_claim_key = 'renewal_claimed_until';

function renewal_claim_is_free(metadata_column: AnyColumn): SQL {
  return sql`coalesce((${metadata_column}->>${renewal_claim_key})::timestamptz, '-infinity'::timestamptz) < now()`;
}

/**
 * One renewal of a sign-in runs at a time. A claim is a time in the account's metadata, so a
 * claim whose holder died ends by itself. True when this caller holds the claim now.
 */
export async function claim_workspace_account_renewal(
  db: DatabaseExecutor,
  input: WorkspaceAccount & RenewalClaim,
): Promise<boolean> {
  const claimed = await db
    .update(connections)
    .set({
      metadata: merge_metadata(connections.metadata, {
        [renewal_claim_key]: input.claimed_until.toISOString(),
      }),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_key, model_provider_account_connection_key(input.provider_slot)),
        eq(connections.connection_status, 'active'),
        renewal_claim_is_free(connections.metadata),
      ),
    )
    .returning({ connection_id: connections.connection_id });
  return claimed.length > 0;
}

export async function claim_install_account_renewal(
  db: DatabaseExecutor,
  input: { provider_slot: ModelProviderAccountSlot } & RenewalClaim,
): Promise<boolean> {
  const claimed = await db
    .update(install_connections)
    .set({
      connection_metadata: merge_metadata(install_connections.connection_metadata, {
        [renewal_claim_key]: input.claimed_until.toISOString(),
      }),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(
          install_connections.connection_key,
          model_provider_account_connection_key(input.provider_slot),
        ),
        eq(install_connections.connection_status, 'active'),
        renewal_claim_is_free(install_connections.connection_metadata),
      ),
    )
    .returning({ connection_key: install_connections.connection_key });
  return claimed.length > 0;
}

/** Locks the row until the transaction ends, so no other write lands between a read and a write. */
export async function lock_workspace_account_values(
  db: DatabaseExecutor,
  input: WorkspaceAccount,
): Promise<Record<string, string> | null> {
  const [row] = await db
    .select({ status: connections.connection_status, credentials: connections.credentials })
    .from(connections)
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_key, model_provider_account_connection_key(input.provider_slot)),
      ),
    )
    .limit(1)
    .for('update');
  if (!row?.credentials || row.status !== 'active') return null;
  return read_connection_credential_values(row.credentials);
}

export async function lock_install_account_values(
  db: DatabaseExecutor,
  provider_slot: ModelProviderAccountSlot,
): Promise<Record<string, string> | null> {
  const [row] = await db
    .select({
      status: install_connections.connection_status,
      credentials: install_connections.credentials,
    })
    .from(install_connections)
    .where(
      eq(install_connections.connection_key, model_provider_account_connection_key(provider_slot)),
    )
    .for('update');
  if (!row || row.status !== 'active') return null;
  return read_connection_credential_values(row.credentials);
}
