import type { Database } from '@coworker/core/db/connection';

export type AdAttribution = Record<string, string | undefined>;

export async function persist_ad_attribution(
  _db: Database,
  _input: { user_id: string; workspace_id: string; actor_id: string; attribution: AdAttribution },
) {}
