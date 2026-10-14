import { read_held_tool_calls } from '@api/services/policies/held_tool_calls';
import { is_policy_manager } from '@api/services/policies/policy_authority';
import { one_rule } from '@api/services/policies/policy_rule_ownership';
import { set_policy_and_record_event } from '@api/services/policies/policy_service';
import type { Database } from '@coworker/core';
import { build_grant_metadata, type PolicyGrant } from '@coworker/core/access/policy_grants';
import type { PolicyScopeDecision } from '@coworker/core/access/policy_modes';
import { resolve_tool_policy_scope_decisions } from '@coworker/core/access/resolve_tool_policies';
import { node_rule_specificity } from '@coworker/core/access/tool_policy_resources';
import type { PolicyScopeType } from '@coworker/core/db/schema/policies';

export type PolicyGrantInput = Omit<PolicyGrant, 'granted_by' | 'granted_time'>;

export type ToolRemembered =
  | { remembered: true; policy_count: number }
  | {
      remembered: false;
      reason: 'banned_outright' | 'not_yours_to_change' | 'nothing_to_remember';
    };

export async function always_allow_tool_calls(
  db: Database,
  input: {
    workspace_id: string;
    user_id: string;
    session_id: string;
    tool_call_ids: readonly string[];
    grant?: PolicyGrantInput;
  },
): Promise<ToolRemembered> {
  const tools = await read_held_tool_calls(db, input.workspace_id, input.tool_call_ids);
  if (tools.length === 0) return { remembered: false, reason: 'nothing_to_remember' };

  const decisions_by_tool = await resolve_tool_policy_scope_decisions(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    actor_id: input.user_id,
    tools,
  });
  if ([...decisions_by_tool.values()].flat().some((scope) => scope.mode === 'never')) {
    return { remembered: false, reason: 'banned_outright' };
  }

  const permissions = read_permissions_to_write(decisions_by_tool);
  if (permissions.length === 0) return { remembered: false, reason: 'nothing_to_remember' };

  for (const permission of permissions) {
    const theirs_to_change = await is_policy_manager(db, {
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      scope_type: permission.scope_type,
      scope_id: permission.scope_id,
      targets: one_rule('node', permission.node_key),
    });
    if (!theirs_to_change) return { remembered: false, reason: 'not_yours_to_change' };
    await set_policy_and_record_event(db, {
      workspace_id: input.workspace_id,
      resource_type: 'node',
      resource_id: permission.node_key,
      scope_type: permission.scope_type,
      scope_id: permission.scope_id,
      policy_mode: 'allow',
      metadata: input.grant
        ? build_grant_metadata({ ...input.grant, granted_by: input.user_id })
        : {},
      actor_id: input.user_id,
    });
  }
  return { remembered: true, policy_count: permissions.length };
}

type ToolPermission = { node_key: string; scope_type: PolicyScopeType; scope_id: string };

function read_permissions_to_write(
  decisions_by_tool: Map<string, PolicyScopeDecision[]>,
): ToolPermission[] {
  return [...decisions_by_tool].flatMap(([node_key, decisions]) =>
    decisions
      .filter(
        (decision) => decision.mode === 'ask' && decision.specificity <= node_rule_specificity,
      )
      .map((decision) => ({
        node_key,
        scope_type: decision.scope_type,
        scope_id: decision.scope_id,
      })),
  );
}
