import type { Database } from '@coworker/core/db/connection';
import {
  app_scope_precedence,
  app_visibility_condition,
  get_app_by_name,
  get_composio_app_by_toolkit,
  not_a_model_credential_app,
} from '@coworker/core/db/queries/catalog';
import { offered_to_anyone } from '@coworker/core/db/queries/catalog_twin_offer';
import { apps } from '@coworker/core/db/schema';
import { and, eq, or, sql } from 'drizzle-orm';

type AppToConnectInput = { workspace_id: string; app_name: string };

/**
 * The app a new connection to `app_name` goes to. The exact catalog name wins. Otherwise the name
 * a person says ("Google Ads") is tried in catalog spelling (googleads, google_ads), first as an
 * app name and then as a hosted-catalog toolkit.
 */
export async function find_app_to_connect(db: Database, input: AppToConnectInput) {
  const exact = await find_offered_app_or_twin_or_connected_app(db, input);
  if (exact) return exact;

  const workspace_id = input.workspace_id;
  const spellings = list_catalog_spellings(input.app_name);
  const new_app_names = spellings.filter((spelling) => spelling !== input.app_name);
  const [by_app_name, by_toolkit] = await Promise.all([
    Promise.all(
      new_app_names.map((app_name) =>
        find_offered_app_or_twin_or_connected_app(db, { workspace_id, app_name }),
      ),
    ),
    Promise.all(
      spellings.map((toolkit_slug) =>
        get_composio_app_by_toolkit(db, { workspace_id, toolkit_slug }),
      ),
    ),
  ]);
  return [...by_app_name, ...by_toolkit].find((app) => app != null) ?? null;
}

export function list_catalog_spellings(spoken_name: string): string[] {
  const words = spoken_name
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 0);
  return [...new Set([words.join(''), words.join('_')])].filter((name) => name.length > 0);
}

async function find_offered_app_or_twin_or_connected_app(db: Database, input: AppToConnectInput) {
  const named_app = sql`(SELECT lower(named_app.app_display_name) FROM apps named_app
    WHERE named_app.app_name = ${input.app_name} AND named_app.app_status IN ('active', 'superseded')
    LIMIT 1)`;
  const offered_app = await db.query.apps.findFirst({
    where: and(
      offered_to_anyone,
      not_a_model_credential_app,
      app_visibility_condition(input.workspace_id),
      or(eq(apps.app_name, input.app_name), sql`lower(apps.app_display_name) = ${named_app}`),
    ),
    orderBy: [
      sql`case when apps.app_name = ${input.app_name} then 0 else 1 end`,
      app_scope_precedence(input.workspace_id),
    ],
  });
  return offered_app ?? get_app_by_name(db, input);
}
