import { connector_catalog_source, read_connector_app_hold } from '@coworker/connectors';
import type { Database } from '@coworker/core';
import { find_app_to_connect } from '@coworker/core/db/queries/app_to_connect';
import { find_why_app_cannot_connect_here } from '@runtime-platform/connections/app_connection_availability';

type AppToConnect = NonNullable<Awaited<ReturnType<typeof find_app_to_connect>>>;

/** The app a name points at. It carries a hold when no setup link can work for it. */
export async function find_connectable_app(db: Database, workspace_id: string, app_name: string) {
  const app = await find_app_to_connect(db, { workspace_id, app_name });
  if (!app) return app;
  const hold = find_why_no_setup_link_can_work(app);
  return hold ? { ...app, hold } : app;
}

function find_why_no_setup_link_can_work(app: AppToConnect) {
  const registry_hold =
    app.metadata.source === connector_catalog_source ? read_connector_app_hold(app.app_name) : null;
  if (registry_hold) return registry_hold;
  const why_not_here = find_why_app_cannot_connect_here(app);
  return why_not_here
    ? { reason: `${why_not_here} Tell the person this in one sentence and send no connect link.` }
    : null;
}
