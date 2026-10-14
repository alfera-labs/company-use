import { read_held_tool_calls } from '@api/services/policies/held_tool_calls';
import { is_policy_manager } from '@api/services/policies/policy_authority';
import { one_rule } from '@api/services/policies/policy_rule_ownership';
import { set_policy_and_record_event } from '@api/services/policies/policy_service';
import type { Database } from '@coworker/core';
import {
  resolve_tool_policy_scope_decisions,
  type ToolPolicyTarget,
} from '@coworker/core/access/resolve_tool_policies';
import { find_tool_call_subjects, tool_call_subject_policy_id } from '@coworker/shared';

export type SubjectRemembered =
  | { remembered: true; scope_count: number }
  | {
      remembered: false;
      reason:
        | 'banned_outright'
        | 'not_yours_to_change'
        | 'nothing_to_change'
        | 'not_part_of_this_call';
    };

export async function always_allow_tool_subject(
  db: Database,
  input: {
    workspace_id: string;
    user_id: string;
    session_id: string;
    tool_call_ids: readonly string[];
    subject_policy_id: string;
  },
): Promise<SubjectRemembered> {
  const calls = await read_held_tool_calls(db, input.workspace_id, input.tool_call_ids);
  const offered = read_tool_call_subject_choices(calls);
  if (!offered.some((subject) => subject.policy_id === input.subject_policy_id)) {
    return { remembered: false, reason: 'not_part_of_this_call' };
  }

  const decisions_by_tool = await resolve_tool_policy_scope_decisions(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    actor_id: input.user_id,
    tools: calls,
  });
  const asking_scopes = [...decisions_by_tool.values()].flat();
  if (asking_scopes.some((scope) => scope.mode === 'never')) {
    return { remembered: false, reason: 'banned_outright' };
  }

  const scopes_to_change = asking_scopes.filter((scope) => scope.mode === 'ask');
  if (scopes_to_change.length === 0) return { remembered: false, reason: 'nothing_to_change' };

  for (const scope of scopes_to_change) {
    const theirs_to_change = await is_policy_manager(db, {
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      scope_type: scope.scope_type,
      scope_id: scope.scope_id,
      targets: one_rule('tool_subject', input.subject_policy_id),
    });
    if (!theirs_to_change) return { remembered: false, reason: 'not_yours_to_change' };
    await set_policy_and_record_event(db, {
      workspace_id: input.workspace_id,
      resource_type: 'tool_subject',
      resource_id: input.subject_policy_id,
      scope_type: scope.scope_type,
      scope_id: scope.scope_id,
      policy_mode: 'allow',
      actor_id: input.user_id,
    });
  }
  return { remembered: true, scope_count: scopes_to_change.length };
}

function read_tool_call_subject_choices(calls: readonly ToolPolicyTarget[]) {
  const by_id = new Map<string, { kind: string; display_name: string; policy_id: string }>();
  for (const call of calls) {
    for (const subject of find_tool_call_subjects(call.tool_input)) {
      const policy_id = tool_call_subject_policy_id(subject, call.node_key);
      if (!by_id.has(policy_id)) {
        by_id.set(policy_id, { kind: subject.kind, display_name: subject.display_name, policy_id });
      }
    }
  }
  return [...by_id.values()];
}
