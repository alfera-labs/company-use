import type { Database } from '@coworker/core/db/connection';

export async function send_welcome_email(_db: Database, _workspace_id: string): Promise<boolean> {
  return false;
}
