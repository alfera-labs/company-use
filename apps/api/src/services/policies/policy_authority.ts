import { get_connection_managed_by_user } from '@api/services/connections/connection_service';
import {
  assert_rules_were_not_set_by_somebody_else,
  type PolicyRuleTargets,
} from '@api/services/policies/policy_rule_ownership';
import type { Database } from '@coworker/core';
import {
  assert_project_manager,
  assert_workspace_administrator,
} from '@coworker/core/access/assert_project_manager';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import type { PolicyScopeType } from '@coworker/core/db/schema/policies';
import { AppError, is_workspace_administrator_role } from '@coworker/shared';

export async function assert_policy_manager(
  db: Database,
  input: {
    workspace_id: string;
    user_id: string;
    scope_type: PolicyScopeType;
    scope_id: string;
    targets: PolicyRuleTargets;
  },
) {
  if (input.scope_type === 'project') {
    return assert_project_manager(db, {
      workspace_id: input.workspace_id,
      project_id: input.scope_id,
      user_id: input.user_id,
    });
  }
  if (input.scope_type === 'connection') {
    await get_connection_managed_by_user(db, {
      workspace_id: input.workspace_id,
      connection_id: input.scope_id,
      acting_user_id: input.user_id,
      actor_id: input.user_id,
    });
    return;
  }
  if (input.scope_type === 'user' && input.scope_id === input.user_id) {
    if (await is_policy_workspace_administrator(db, input)) return;
    return assert_rules_were_not_set_by_somebody_else(db, {
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      scope: { scope_type: input.scope_type, scope_id: input.scope_id },
      targets: input.targets,
    });
  }
  return assert_workspace_administrator(db, {
    workspace_id: input.workspace_id,
    user_id: input.user_id,
  });
}

export async function is_policy_manager(
  db: Database,
  input: Parameters<typeof assert_policy_manager>[1],
): Promise<boolean> {
  try {
    await assert_policy_manager(db, input);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.status === 403) return false;
    throw error;
  }
}

export async function assert_policy_decider(
  db: Database,
  input: { workspace_id: string; user_id: string; eligible_user_ids: readonly string[] },
) {
  if (input.eligible_user_ids.includes(input.user_id)) return;
  if (await is_policy_workspace_administrator(db, input)) return;
  throw new AppError(
    'approval_access_denied',
    'Only the person this was asked of, or a workspace owner or admin, can answer it.',
    403,
  );
}

export async function may_answer_the_choices(
  db: Database,
  input: { workspace_id: string; user_id: string; eligible_user_ids: readonly string[] },
) {
  if (input.eligible_user_ids.length === 0) return true;
  if (input.eligible_user_ids.includes(input.user_id)) return true;
  return is_policy_workspace_administrator(db, {
    workspace_id: input.workspace_id,
    user_id: input.user_id,
  });
}

export async function assert_choices_answerer(
  db: Database,
  input: { workspace_id: string; user_id: string; eligible_user_ids: readonly string[] },
) {
  if (await may_answer_the_choices(db, input)) return;
  return assert_workspace_administrator(db, {
    workspace_id: input.workspace_id,
    user_id: input.user_id,
  });
}

export async function is_policy_workspace_administrator(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  const role = await find_active_workspace_member_role(db, input);
  return is_workspace_administrator_role(role);
}
