import { apps, connections, type Database } from '@coworker/core';
import {
  native_slack_app_name,
  native_slack_connection_profile_key,
  native_slack_provider_config_key,
  native_slack_provider_key,
} from '@runtime-platform/tools/slack/app_profile';
import { and, eq } from 'drizzle-orm';

export type ActiveSlackConnection = typeof connections.$inferSelect;

export async function find_native_slack_app(db: Database) {
  const row = await db.query.apps.findFirst({
    where: and(eq(apps.app_name, native_slack_app_name), eq(apps.catalog_scope, 'global')),
  });
  return row ?? null;
}

export async function find_active_slack_connection_for_workspace(
  db: Database,
  workspace_id: string,
): Promise<ActiveSlackConnection | null> {
  const row = await db.query.connections.findFirst({
    where: and(
      eq(connections.workspace_id, workspace_id),
      eq(connections.provider_key, native_slack_provider_key),
      eq(connections.provider_config_key, native_slack_provider_config_key),
      eq(connections.connection_profile_key, native_slack_connection_profile_key),
      eq(connections.connection_status, 'active'),
    ),
    orderBy: (table, { desc }) => [desc(table.created_time)],
  });
  return row ?? null;
}

export async function find_active_slack_connection_for_workspace_team(
  db: Database,
  input: { workspace_id: string; team_id: string },
): Promise<ActiveSlackConnection | null> {
  const row = await db.query.connections.findFirst({
    where: and(
      eq(connections.workspace_id, input.workspace_id),
      eq(connections.external_account_id, input.team_id),
      eq(connections.provider_key, native_slack_provider_key),
      eq(connections.provider_config_key, native_slack_provider_config_key),
      eq(connections.connection_profile_key, native_slack_connection_profile_key),
      eq(connections.connection_status, 'active'),
    ),
    orderBy: (table, { desc }) => [desc(table.created_time)],
  });
  return row ?? null;
}
