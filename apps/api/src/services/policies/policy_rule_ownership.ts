import type { Database } from '@coworker/core';
import type { PolicyResourceRef, PolicyScopeRef } from '@coworker/core/db/queries/policies';
import { list_policies_in_scope_set_by_others } from '@coworker/core/db/queries/policy_scope_rules';
import { AppError } from '@coworker/shared';

export type PolicyRuleTargets = {
  resources: readonly PolicyResourceRef[];
  policy_ids: readonly string[];
};

export function one_rule(resource_type: string, resource_id: string): PolicyRuleTargets {
  return { resources: [{ resource_type, resource_id }], policy_ids: [] };
}

/**
 * A person manages the rules in their own scope. A rule somebody else put there is a limit on
 * them, not a preference of theirs, so they cannot change it or remove it.
 */
export async function assert_rules_were_not_set_by_somebody_else(
  db: Database,
  input: {
    workspace_id: string;
    user_id: string;
    scope: PolicyScopeRef;
    targets: PolicyRuleTargets;
  },
): Promise<void> {
  const set_by_others = await list_policies_in_scope_set_by_others(db, {
    workspace_id: input.workspace_id,
    ...input.scope,
    user_id: input.user_id,
  });
  if (!set_by_others.some((rule) => is_a_target(input.targets, rule))) return;

  throw new AppError(
    'policy_rule_set_by_administrator',
    'A workspace owner or admin set this rule for you. Only they can change it.',
    403,
  );
}

function is_a_target(targets: PolicyRuleTargets, rule: PolicyResourceRef & { policy_id: string }) {
  return (
    targets.policy_ids.includes(rule.policy_id) ||
    targets.resources.some(
      (resource) =>
        resource.resource_type === rule.resource_type && resource.resource_id === rule.resource_id,
    )
  );
}
