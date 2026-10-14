import type { Database } from '@coworker/core/db/connection';
import { apps } from '@coworker/core/db/schema';
import { native_preferred_app_names } from '@coworker/core/integrations/native_preferred_apps';
import { and, inArray, sql } from 'drizzle-orm';

const sourced_from_provider = sql`coalesce(apps.metadata->'sourced_from'->>'provider', '')`;
const preferred_native_app_names = sql.join(
  native_preferred_app_names.map((app_name) => sql`${app_name}`),
  sql`, `,
);
const is_composio_twin_of_preferred_native = sql`(${sourced_from_provider} = 'composio'
  AND lower(apps.app_display_name) IN (
    SELECT lower(preferred_native.app_display_name) FROM apps preferred_native
    WHERE preferred_native.app_status = 'active'
      AND preferred_native.metadata->'sourced_from'->>'provider' = 'native'
      AND preferred_native.app_name IN (${preferred_native_app_names})
  ))`;
export const is_native_twin_of_composio_app = sql`(${sourced_from_provider} = 'native'
  AND apps.app_name NOT IN (${preferred_native_app_names})
  AND lower(apps.app_display_name) IN (
    SELECT lower(composio_names.app_display_name) FROM apps composio_names
    WHERE composio_names.app_status = 'active'
      AND composio_names.metadata->'sourced_from'->>'provider' = 'composio'
  ))`;
const is_hidden_twin = sql`(${is_composio_twin_of_preferred_native} OR ${is_native_twin_of_composio_app})`;

/**
 * An active app offered to every workspace. When Composio and one of our own connectors offer an
 * app under one name, Composio's is on offer and ours is hidden, unless ours is in
 * native_preferred_app_names. The name lists are uncorrelated subqueries that Postgres hashes once
 * per query, so no per-row twin lookup runs (a dev catalog scan: 11.7s with one, 34ms without).
 */
export const offered_to_anyone = sql`(apps.app_status = 'active' AND NOT ${is_hidden_twin})`;

/** The ids among `app_ids` of our own apps now hidden behind their Composio twin. */
export async function list_app_ids_with_newer_connector(db: Database, app_ids: readonly string[]) {
  if (app_ids.length === 0) return new Set<string>();
  const rows = await db
    .select({ app_id: apps.app_id })
    .from(apps)
    .where(and(inArray(apps.app_id, [...app_ids]), is_native_twin_of_composio_app));
  return new Set(rows.map((row) => row.app_id));
}
