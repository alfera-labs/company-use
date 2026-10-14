import type { Database } from '@coworker/core/db/connection';
import { apps } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';

export async function get_app_name(db: Database, app_id: string) {
  const [row] = await db
    .select({ app_name: apps.app_name })
    .from(apps)
    .where(eq(apps.app_id, app_id))
    .limit(1);
  return row?.app_name ?? null;
}
