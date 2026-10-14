import { connections, type Database } from '@coworker/core';
import type {
  ConnectionCredentialData,
  ProviderAccountData,
} from '@coworker/core/db/schema/json_column_types';
import {
  native_slack_provider_config_key,
  native_slack_provider_key,
} from '@runtime-platform/tools/slack/app_profile';
import { and, eq, inArray, ne } from 'drizzle-orm';

const exclusive_external_account_provider_configs = [
  {
    provider_key: native_slack_provider_key,
    provider_config_key: native_slack_provider_config_key,
  },
] as const;

export function claims_external_account_exclusively(input: {
  provider_key?: string | null;
  provider_config_key?: string | null;
}): boolean {
  return exclusive_external_account_provider_configs.some(
    (config) =>
      config.provider_key === input.provider_key &&
      config.provider_config_key === input.provider_config_key,
  );
}

export type ExclusiveClaimIncumbent = {
  connection_id: string;
  workspace_id: string;
  credentials?: ConnectionCredentialData | null;
  provider_account?: ProviderAccountData | null;
};

export type IncumbentLiveness = 'alive' | 'dead' | 'unknown';

export type ExclusiveClaimResult =
  | { outcome: 'not_exclusive' }
  | { outcome: 'claimed'; released: Array<{ connection_id: string; workspace_id: string }> }
  | { outcome: 'conflict'; incumbent_workspace_id: string; incumbent_connection_id: string };

export async function claim_external_account_for_connection(
  db: Database,
  input: {
    provider_key?: string | null;
    provider_config_key?: string | null;
    external_account_id: string;
    claiming_workspace_id: string;
    claiming_connection_id: string;
    actor_id: string;
    probe_incumbent_liveness: (incumbent: ExclusiveClaimIncumbent) => Promise<IncumbentLiveness>;
  },
): Promise<ExclusiveClaimResult> {
  if (!claims_external_account_exclusively(input) || !input.external_account_id) {
    return { outcome: 'not_exclusive' };
  }

  const incumbents = await db.query.connections.findMany({
    where: and(
      eq(connections.provider_key, input.provider_key ?? ''),
      eq(connections.provider_config_key, input.provider_config_key ?? ''),
      eq(connections.external_account_id, input.external_account_id),
      eq(connections.connection_status, 'active'),
      ne(connections.connection_id, input.claiming_connection_id),
    ),
  });
  if (incumbents.length === 0) return { outcome: 'claimed', released: [] };

  for (const incumbent of incumbents) {
    if (incumbent.workspace_id === input.claiming_workspace_id) continue;
    const liveness = await input.probe_incumbent_liveness({
      connection_id: incumbent.connection_id,
      workspace_id: incumbent.workspace_id,
      credentials: incumbent.credentials,
      provider_account: incumbent.provider_account,
    });
    if (liveness !== 'dead') {
      return {
        outcome: 'conflict',
        incumbent_workspace_id: incumbent.workspace_id,
        incumbent_connection_id: incumbent.connection_id,
      };
    }
  }

  const released = await revoke_superseded_claims(db, {
    connection_ids: incumbents.map((incumbent) => incumbent.connection_id),
    actor_id: input.actor_id,
  });
  return { outcome: 'claimed', released };
}

export async function release_exclusive_account_claim(
  db: Database,
  input: {
    provider_key: string;
    provider_config_key: string;
    external_account_id: string;
    actor_id: string;
  },
) {
  return db
    .update(connections)
    .set({
      connection_status: 'revoked',
      health_status: 'unhealthy',
      revoked_time: new Date(),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(connections.provider_key, input.provider_key),
        eq(connections.provider_config_key, input.provider_config_key),
        eq(connections.external_account_id, input.external_account_id),
        eq(connections.connection_status, 'active'),
      ),
    )
    .returning({
      connection_id: connections.connection_id,
      workspace_id: connections.workspace_id,
    });
}

async function revoke_superseded_claims(
  db: Database,
  input: { connection_ids: string[]; actor_id: string },
) {
  if (input.connection_ids.length === 0) return [];

  return db
    .update(connections)
    .set({
      connection_status: 'revoked',
      health_status: 'unhealthy',
      revoked_time: new Date(),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        inArray(connections.connection_id, input.connection_ids),
        eq(connections.connection_status, 'active'),
      ),
    )
    .returning({
      connection_id: connections.connection_id,
      workspace_id: connections.workspace_id,
    });
}
