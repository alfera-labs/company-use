import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { apps } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';

export type McpServerIdentityUpdate = {
  name?: string | null;
  description?: string | null;
  icon_url?: string | null;
};

export async function record_mcp_sync_outcome(
  db: DatabaseExecutor,
  input: {
    app_id: string;
    actor_id: string;
    tool_list_digest?: string | undefined;
    listed_tool_count?: number | undefined;
    last_error_message?: string | null;
    identity?: McpServerIdentityUpdate | undefined;
  },
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.app_id, input.app_id) });
  if (!app) return;

  const identity = input.identity ?? {};
  const keeps_the_name_a_person_typed = app.metadata.mcp_named_by_person === true;
  await db
    .update(apps)
    .set({
      ...(identity.name && !keeps_the_name_a_person_typed
        ? { app_display_name: identity.name }
        : {}),
      metadata: {
        ...app.metadata,
        ...(identity.icon_url ? { icon_url: identity.icon_url } : {}),
        ...(identity.description ? { description: identity.description } : {}),
        mcp_sync: {
          last_synced_time: new Date().toISOString(),
          tool_list_digest: input.tool_list_digest ?? null,
          listed_tool_count: input.listed_tool_count ?? null,
          last_error_message: input.last_error_message ?? null,
        },
      },
      last_updated_by: input.actor_id,
      last_updated_time: new Date(),
    })
    .where(eq(apps.app_id, input.app_id));
}
