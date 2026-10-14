import type { Database } from '@coworker/core/db/connection';
import { workspaces } from '@coworker/core/db/schema';
import { AppError } from '@coworker/shared';
import { eq, sql } from 'drizzle-orm';

export type WorkspaceInboundEmailSettings = {
  enabled: boolean;
  attribution_enabled: boolean;
};

const default_workspace_inbound_email_settings: WorkspaceInboundEmailSettings = {
  enabled: true,
  attribution_enabled: true,
};

export async function read_workspace_inbound_email_settings(
  db: Database,
  workspace_id: string,
): Promise<WorkspaceInboundEmailSettings> {
  const [row] = await db
    .select({ workspace_data: workspaces.workspace_data })
    .from(workspaces)
    .where(eq(workspaces.workspace_id, workspace_id))
    .limit(1);
  const stored = row?.workspace_data.inbound_email;
  return {
    enabled: stored?.enabled ?? default_workspace_inbound_email_settings.enabled,
    attribution_enabled:
      stored?.attribution_enabled ?? default_workspace_inbound_email_settings.attribution_enabled,
  };
}

export async function write_workspace_inbound_email_settings(
  db: Database,
  input: {
    workspace_id: string;
    actor_id: string;
    settings: Partial<WorkspaceInboundEmailSettings>;
  },
): Promise<WorkspaceInboundEmailSettings> {
  const patch: Partial<WorkspaceInboundEmailSettings> = {
    ...(input.settings.enabled === undefined ? {} : { enabled: input.settings.enabled }),
    ...(input.settings.attribution_enabled === undefined
      ? {}
      : { attribution_enabled: input.settings.attribution_enabled }),
  };

  const [row] = await db
    .update(workspaces)
    .set({
      workspace_data: sql`coalesce(${workspaces.workspace_data}, '{}'::jsonb) || jsonb_build_object(
        'inbound_email',
        coalesce(${workspaces.workspace_data} -> 'inbound_email', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
      )`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(workspaces.workspace_id, input.workspace_id))
    .returning({ workspace_data: workspaces.workspace_data });
  if (!row) throw new AppError('not_found', 'Workspace not found', 404);

  const stored = row.workspace_data.inbound_email;
  return {
    enabled: stored?.enabled ?? default_workspace_inbound_email_settings.enabled,
    attribution_enabled:
      stored?.attribution_enabled ?? default_workspace_inbound_email_settings.attribution_enabled,
  };
}
