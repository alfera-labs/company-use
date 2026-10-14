import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { apps, nodes } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import {
  build_mcp_node_values,
  generate_mcp_app_name,
  type McpToolSeed,
} from '@coworker/core/integrations/mcp_catalog_node_values';
import {
  build_mcp_node_row,
  build_workspace_mcp_app,
} from '@coworker/core/integrations/mcp_catalog_rows';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

export type { McpToolSeed } from '@coworker/core/integrations/mcp_catalog_node_values';

export async function create_workspace_mcp_catalog(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    server_key: string;
    server_name: string;
    transport_config: Record<string, unknown>;
    auth_config?: Record<string, unknown>;
    setup_strategy?: Record<string, unknown>;
    icon_url?: string | undefined;
    description?: string | undefined;
    named_by_person?: boolean | undefined;
    tools: McpToolSeed[];
    actor_id: string;
    trust_tool_annotations?: boolean;
  },
) {
  const app_id = create_id(id_prefixes.app);
  const app_name = generate_mcp_app_name(input.server_key);
  const node_values = build_mcp_node_values({
    app_name,
    server_key: input.server_key,
    tools: input.tools,
    trust_tool_annotations: input.trust_tool_annotations ?? false,
  });
  const rows = node_values.map((values) =>
    build_mcp_node_row({ ...input, app_id, app_name, values }),
  );

  return db.transaction(async (tx) => {
    await tx.insert(apps).values(build_workspace_mcp_app({ ...input, app_id, app_name }));
    const created_nodes = rows.length ? await tx.insert(nodes).values(rows).returning() : [];
    return { app_id, app_name, nodes: created_nodes };
  });
}

export async function find_workspace_mcp_app(
  db: DatabaseExecutor,
  input: { workspace_id: string; server_key: string },
) {
  return (
    (await db.query.apps.findFirst({
      where: and(
        eq(apps.workspace_id, input.workspace_id),
        eq(apps.catalog_scope, 'workspace'),
        eq(apps.app_name, generate_mcp_app_name(input.server_key)),
      ),
    })) ?? null
  );
}

export async function list_taken_mcp_server_keys(
  db: DatabaseExecutor,
  input: { workspace_id: string; server_keys: readonly string[] },
): Promise<string[]> {
  const app_names = new Map(input.server_keys.map((key) => [generate_mcp_app_name(key), key]));
  const taken = await db
    .select({ app_name: apps.app_name })
    .from(apps)
    .where(
      and(
        eq(apps.workspace_id, input.workspace_id),
        eq(apps.catalog_scope, 'workspace'),
        inArray(apps.app_name, [...app_names.keys()]),
      ),
    );
  return taken.flatMap((app) => app_names.get(app.app_name) ?? []);
}

export async function find_workspace_mcp_app_by_endpoint_url(
  db: DatabaseExecutor,
  input: { workspace_id: string; endpoint_url: string },
) {
  const stored_address = JSON.stringify({
    provider_configs: [{ provider_key: 'mcp', setup_defaults: { url: input.endpoint_url } }],
  });
  return (
    (await db.query.apps.findFirst({
      where: and(
        eq(apps.workspace_id, input.workspace_id),
        eq(apps.catalog_scope, 'workspace'),
        sql`${apps.metadata} @> ${stored_address}::jsonb`,
      ),
    })) ?? null
  );
}

export async function set_workspace_mcp_oauth_client(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    app_id: string;
    client_id: string;
    has_client_secret: boolean;
    actor_id: string;
  },
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.app_id, input.app_id) });
  if (!app) return;

  const provider_configs = (app.metadata.provider_configs ?? []).map((config) =>
    config.provider_key !== 'mcp'
      ? config
      : {
          ...config,
          connection_profiles: config.connection_profiles.map((profile) => ({
            ...profile,
            setup_strategy: {
              ...profile.setup_strategy,
              client_id: input.client_id,
              ...(input.has_client_secret ? { token_auth_method: 'client_secret_post' } : {}),
            },
          })),
        },
  );

  await db
    .update(apps)
    .set({
      metadata: { ...app.metadata, provider_configs },
      ...updated_by(input.actor_id),
    })
    .where(and(eq(apps.workspace_id, input.workspace_id), eq(apps.app_id, input.app_id)));
}

/**
 * Makes a server that waited for a token or a sign-in take no credential, so that it can be
 * added again with a key in a header, or with nothing. Only for a server with no active
 * connection: the tools of a server in use look for the connections it has. The next tool sync
 * moves its tools to the open kind.
 */
export async function set_workspace_mcp_app_to_take_no_credential(
  db: DatabaseExecutor,
  input: { workspace_id: string; app_id: string; actor_id: string },
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.app_id, input.app_id) });
  if (!app) return;

  const provider_configs = (app.metadata.provider_configs ?? []).map((config) =>
    config.provider_key === 'mcp' ? { ...config, connection_profiles: [] } : config,
  );
  await db
    .update(apps)
    .set({
      auth_type: 'none',
      metadata: { ...app.metadata, provider_configs },
      ...updated_by(input.actor_id),
    })
    .where(and(eq(apps.workspace_id, input.workspace_id), eq(apps.app_id, input.app_id)));
}
