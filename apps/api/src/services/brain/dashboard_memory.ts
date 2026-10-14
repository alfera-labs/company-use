import type { ApiEnv } from '@api/lib/context';
import type { Database } from '@coworker/core/db/connection';
import type { Context } from 'hono';

export type DashboardCaller = { db: Database; workspace_id: string; user_id: string };

export function dashboard_caller(c: Context<ApiEnv>): DashboardCaller {
  return { db: c.get('db'), workspace_id: c.get('workspace_id'), user_id: c.get('user_id') };
}
