import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';

export const unlimited_credit_balance_microcents = Number.MAX_SAFE_INTEGER;

export async function get_credit_balance_microcents(_db: DatabaseExecutor, _workspace_id: string) {
  return unlimited_credit_balance_microcents;
}

export async function last_credit_grant_time(
  _db: Database,
  _workspace_id: string,
): Promise<Date | null> {
  return null;
}
