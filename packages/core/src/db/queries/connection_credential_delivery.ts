import { parse_app_config } from '@coworker/core/credentials/app_credential_config';
import type { CredentialToDeliver } from '@coworker/core/credentials/egress_header_rules';
import type { Database } from '@coworker/core/db/connection';
import { apps, connections } from '@coworker/core/db/schema';
import { read_connection_credential_values } from '@coworker/core/integrations/credential_envelope';
import { and, eq, gt, isNull, or } from 'drizzle-orm';

export async function list_credentials_to_deliver(
  db: Database,
  input: { workspace_id: string; now: Date },
): Promise<CredentialToDeliver[]> {
  const rows = await db
    .select({
      connection_id: connections.connection_id,
      connection_name: connections.connection_name,
      credentials: connections.credentials,
      app_config: apps.app_config,
    })
    .from(connections)
    .innerJoin(apps, eq(connections.app_id, apps.app_id))
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_status, 'active'),
        isNull(connections.revoked_time),
        or(
          isNull(connections.credential_expiry_time),
          gt(connections.credential_expiry_time, input.now),
        ),
      ),
    );

  return rows.flatMap((row) => {
    const rules = parse_app_config(row.app_config).add_to_every_request;
    if (rules.length === 0) return [];
    return [
      {
        connection_name: row.connection_name ?? row.connection_id,
        rules,
        field_values: read_connection_credential_values(row.credentials),
      },
    ];
  });
}
