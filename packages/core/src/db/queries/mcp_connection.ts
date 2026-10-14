import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { connections } from '@coworker/core/db/schema';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { mcp_header_credential_key } from '@coworker/core/integrations/mcp_credential_keys';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq } from 'drizzle-orm';

/** The newest active connection of a server, or null when nobody is connected to it. */
export async function find_active_mcp_connection(
  db: DatabaseExecutor,
  input: { workspace_id: string; app_id: string },
) {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(connections.workspace_id, input.workspace_id),
      eq(connections.app_id, input.app_id),
      eq(connections.connection_status, 'active'),
    ),
    orderBy: (table, { desc }) => [desc(table.created_time)],
  });
  return connection ?? null;
}

export async function create_active_mcp_connection(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    app_id: string;
    server_key: string;
    connection_name: string;
    actor_id: string;
    access_token?: string | undefined;
    request_headers?: Record<string, string> | undefined;
  },
): Promise<{ connection_id: string }> {
  const connection_id = create_id(id_prefixes.connection);
  const header_values = Object.fromEntries(
    Object.entries(input.request_headers ?? {}).map(([name, value]) => [
      mcp_header_credential_key(name),
      value,
    ]),
  );
  const authentication = input.access_token
    ? {
        connection_profile_key: `mcp:${input.server_key}:workspace_credentials`,
        auth_method_key: 'mcp_workspace_credentials',
        credentials: encrypt_connection_credentials({
          credential_source: 'manual',
          values: { access_token: input.access_token, ...header_values },
        }),
      }
    : {
        connection_profile_key: `mcp:${input.server_key}:open`,
        auth_method_key: 'none',
        credentials:
          Object.keys(header_values).length > 0
            ? encrypt_connection_credentials({
                credential_source: 'manual',
                values: header_values,
              })
            : null,
      };

  await db.insert(connections).values({
    connection_id,
    workspace_id: input.workspace_id,
    app_id: input.app_id,
    connection_key: `mcp:${input.server_key}:${connection_id}`,
    connection_name: input.connection_name,
    connection_status: 'active',
    provider_key: 'mcp',
    provider_config_key: `mcp:${input.server_key}:workspace`,
    provider_config_version: 1,
    connection_profile_version: 1,
    ...authentication,
    connection_config: {},
    connected_by: input.actor_id,
    connected_time: new Date(),
    metadata: {},
    created_by: input.actor_id,
    last_updated_by: input.actor_id,
  });

  return { connection_id };
}
