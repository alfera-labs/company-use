import type { DatabaseExecutor } from '@coworker/core/db/connection';
import type { PolicyScopeRef } from '@coworker/core/db/queries/policies';
import { policies } from '@coworker/core/db/schema';
import { and, eq, inArray, ne } from 'drizzle-orm';

type ScopeInWorkspace = PolicyScopeRef & { workspace_id: string };

export async function delete_policies_in_scope(
  db: DatabaseExecutor,
  input: ScopeInWorkspace & { policy_ids: readonly string[] },
) {
  if (input.policy_ids.length === 0) return [];
  return db
    .delete(policies)
    .where(and(is_in_scope(input), inArray(policies.policy_id, [...input.policy_ids])))
    .returning();
}

export async function list_policies_in_scope_set_by_others(
  db: DatabaseExecutor,
  input: ScopeInWorkspace & { user_id: string },
) {
  return db
    .select({
      policy_id: policies.policy_id,
      resource_type: policies.resource_type,
      resource_id: policies.resource_id,
    })
    .from(policies)
    .where(and(is_in_scope(input), ne(policies.last_updated_by, input.user_id)));
}

function is_in_scope(scope: ScopeInWorkspace) {
  return and(
    eq(policies.workspace_id, scope.workspace_id),
    eq(policies.scope_type, scope.scope_type),
    eq(policies.scope_id, scope.scope_id),
  );
}
