import type { Database } from '@coworker/core';
import { resolve_tool_policy_mode } from '@coworker/core/access/resolve_tool_policies';
import {
  consume_tool_policy_approval,
  hash_tool_input_for_approval,
} from '@coworker/core/db/queries/event_waits';
import type { ToolPolicyApprovalGrantData } from '@coworker/core/db/schema/json_column_types';
import type { RuntimeToolResult } from '@coworker/shared';
import { read_input_as_it_will_run } from '@runtime-platform/tools/policies/tool_policy_call';
import { read_automation_id } from '@runtime-platform/tools/source_metadata';
import type { RuntimeToolSourceContext } from '@runtime-platform/tools/types';

export type ToolPolicyGateResult = {
  error: RuntimeToolResult | null;
  approval_granted: boolean;
};

export async function find_tool_policy_error(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    agent_id?: string;
    actor_id: string;
    acting_actor_id?: string;
    node_key: string;
    tool_input: unknown;
    connection_id: string | null;
    approval_policy: Record<string, unknown>;
    metadata: Record<string, unknown>;
    source_context?: RuntimeToolSourceContext;
  },
): Promise<RuntimeToolResult | null> {
  return (await evaluate_tool_policy_gate(db, input)).error;
}

export async function evaluate_tool_policy_gate(
  db: Database,
  input: Parameters<typeof find_tool_policy_error>[1],
): Promise<ToolPolicyGateResult> {
  const runs_with = read_input_as_it_will_run(input.node_key, input.tool_input);
  const mode = await resolve_tool_policy_mode(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    ...(input.agent_id ? { agent_id: input.agent_id } : {}),
    actor_id: input.actor_id,
    ...(input.acting_actor_id ? { acting_actor_id: input.acting_actor_id } : {}),
    automation_id: read_automation_id(input.source_context),
    tool: {
      node_key: input.node_key,
      connection_id: input.connection_id,
      approval_policy: input.approval_policy,
      metadata: input.metadata,
      tool_input: runs_with,
    },
  });
  if (mode === 'allow') return gate_result(null);
  if (mode === 'never') return gate_result(blocked_result(input));

  const grant = input.source_context?.source_metadata?.policy_approval;
  const input_sha256 = hash_tool_input_for_approval(runs_with);
  if (!grant || !matches_grant(grant, input.node_key, input_sha256)) {
    return gate_result(unheld_result(input));
  }
  if (grant.answer === 'already_given') return gate_result(null, true);

  const consumed = await consume_tool_policy_approval(db, {
    workspace_id: input.workspace_id,
    job_id: grant.job_id,
    tool_call_id: grant.tool_call_id ?? `${grant.job_id}:${grant.node_key}`,
  });
  if (!consumed) return gate_result(spent_result(input));
  return gate_result(null, true);
}

function matches_grant(grant: ToolPolicyApprovalGrantData, node_key: string, input_sha256: string) {
  return grant.version === 1 && grant.node_key === node_key && grant.input_sha256 === input_sha256;
}

function blocked_result(input: { node_key: string; connection_id: string | null }) {
  return tool_error(
    'tool_blocked_by_workspace_policy',
    `${input.node_key} is set to Never by an applicable policy, so it cannot run.`,
    { node_key: input.node_key, connection_id: input.connection_id },
  );
}

function spent_result(input: { node_key: string }) {
  return tool_error(
    'approval_already_spent',
    `The approval for ${input.node_key} was already used for this exact call. It runs once per decision.`,
    { node_key: input.node_key },
  );
}

function unheld_result(input: { node_key: string; connection_id: string | null }) {
  return tool_error(
    'approval_required',
    `${input.node_key} needs a person's approval and this call was not held for one, so it did not run. Ask for it as a normal step instead of calling it from inside another tool.`,
    { node_key: input.node_key, connection_id: input.connection_id },
  );
}

function gate_result(error: RuntimeToolResult | null, approval_granted = false) {
  return { error, approval_granted } satisfies ToolPolicyGateResult;
}

function tool_error(code: string, message: string, metadata: Record<string, unknown>) {
  return { success: false, error: { code, message }, metadata } satisfies RuntimeToolResult;
}
