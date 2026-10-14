import { connector_catalog_source, read_connector_app_hold } from '@coworker/connectors';
import type { Database } from '@coworker/core';
import { get_visible_workspace_app } from '@coworker/core/db/queries/connection_management';
import { AppError } from '@coworker/shared';
import { find_native_slack_app } from '@runtime-platform/channels/slack/workspace_connection';
import { find_why_app_cannot_connect_here } from '@runtime-platform/connections/app_connection_availability';

/** Stops a setup before any connection row exists when this install cannot connect the app. */
export async function refuse_app_that_cannot_connect_here(
  db: Database,
  input: { workspace_id: string; app_id: string },
) {
  const app = await get_visible_workspace_app(db, input.workspace_id, input.app_id);
  if (!app) return;
  const hold =
    app.metadata.source === connector_catalog_source ? read_connector_app_hold(app.app_name) : null;
  if (hold) throw new AppError('app_on_hold', hold.reason, 422);
  const why_not_here = find_why_app_cannot_connect_here(app);
  if (why_not_here) throw new AppError('app_not_set_up', why_not_here, 422);
}

export async function find_slack_app_this_install_can_connect(db: Database) {
  const app = await find_native_slack_app(db);
  if (!app) {
    throw new AppError('slack_app_unavailable', 'Slack is not available in the catalog yet.', 409);
  }
  const why_not_here = find_why_app_cannot_connect_here(app);
  if (why_not_here) throw new AppError('slack_connect_unavailable', why_not_here, 409);
  return app;
}
