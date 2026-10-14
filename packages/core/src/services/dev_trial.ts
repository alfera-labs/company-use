import type { Database } from '@coworker/core/db/connection';

export async function grant_workspace_dev_skip_plan(
  _db: Database,
  _input: { workspace_id: string; actor_id: string },
) {
  return { plan_slug: 'none', balance_microcents: 0 };
}
