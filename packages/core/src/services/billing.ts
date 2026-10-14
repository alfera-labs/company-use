import type { Database } from '@coworker/core/db/connection';
import type { WorkspaceModelAccess } from '@coworker/shared';

export function billing_is_enabled() {
  return false;
}

export async function grant_welcome_credit(
  _db: Database,
  _input: { workspace_id: string; user_id: string },
): Promise<boolean> {
  return false;
}

export async function workspace_may_run_billed_background_work(
  _db: Database,
  _workspace_id: string,
) {
  return true;
}

export async function assert_workspace_may_sync_brain(_db: Database, _workspace_id: string) {}

export async function workspace_model_access(
  _db: Database,
  _workspace_id: string,
): Promise<WorkspaceModelAccess> {
  return 'all';
}

export async function workspace_billing_context_line(
  _db: Database,
  _workspace_id: string,
): Promise<string | null> {
  return null;
}

export async function assert_workspace_has_credit(_db: Database, _workspace_id: string) {}
