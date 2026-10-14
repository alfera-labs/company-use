import {
  type PolicyMode,
  type PolicyScopeType,
  policy_scope_types,
} from '@coworker/core/db/schema/policies';

export type PolicyScopeIds = Readonly<Record<PolicyScopeType, readonly string[]>>;

export type PolicyResourceCandidate = {
  resource_type: string;
  resource_id: string;
  specificity: number;
};

export type PolicyRule = {
  resource_type: string;
  resource_id: string;
  scope_type: string;
  scope_id: string;
  policy_mode: string;
};

const policy_mode_rank: Record<PolicyMode, number> = {
  allow: 0,
  ask: 1,
  never: 2,
};

export type PolicyScopeDecision = {
  scope_type: PolicyScopeType;
  scope_id: string;
  mode: PolicyMode;
  specificity: number;
};

export function resolve_policy_mode(input: {
  rules: readonly PolicyRule[];
  resources: readonly PolicyResourceCandidate[];
  scopes: PolicyScopeIds;
}): PolicyMode {
  return combine_scope_decisions(resolve_policy_mode_by_scope(input));
}

export function combine_scope_decisions(decisions: readonly PolicyScopeDecision[]): PolicyMode {
  return decisions.reduce(
    (mode, decision) => stricter_mode(mode, decision.mode),
    'allow' as PolicyMode,
  );
}

export function resolve_policy_mode_by_scope(input: {
  rules: readonly PolicyRule[];
  resources: readonly PolicyResourceCandidate[];
  scopes: PolicyScopeIds;
}): PolicyScopeDecision[] {
  const resources = new Map(
    input.resources.map((resource) => [resource_key(resource), resource.specificity]),
  );
  const scopes = scope_key_set(input.scopes);
  const best_rule_by_scope = new Map<string, PolicyScopeDecision>();

  for (const rule of input.rules) {
    const scope_key = `${rule.scope_type}:${rule.scope_id}`;
    const specificity = resources.get(resource_key(rule));
    if (!scopes.has(scope_key) || specificity === undefined) continue;

    const decision = {
      scope_type: rule.scope_type as PolicyScopeType,
      scope_id: rule.scope_id,
      mode: parse_policy_mode(rule.policy_mode),
      specificity,
    };
    const current = best_rule_by_scope.get(scope_key);
    if (!current || specificity > current.specificity) {
      best_rule_by_scope.set(scope_key, decision);
      continue;
    }
    if (
      specificity === current.specificity &&
      stricter_mode(decision.mode, current.mode) === decision.mode
    ) {
      best_rule_by_scope.set(scope_key, decision);
    }
  }

  return [...best_rule_by_scope.values()];
}

function stricter_mode(left: PolicyMode, right: PolicyMode): PolicyMode {
  return policy_mode_rank[left] >= policy_mode_rank[right] ? left : right;
}

function parse_policy_mode(value: string): PolicyMode {
  if (value === 'allow' || value === 'ask' || value === 'never') return value;
  throw new Error(`Invalid policy mode: ${value}`);
}

function resource_key(resource: { resource_type: string; resource_id: string }) {
  return `${resource.resource_type}:${resource.resource_id}`;
}

function scope_key_set(scopes: PolicyScopeIds) {
  return new Set(
    policy_scope_types.flatMap((scope_type) =>
      scopes[scope_type].map((scope_id) => `${scope_type}:${scope_id}`),
    ),
  );
}
