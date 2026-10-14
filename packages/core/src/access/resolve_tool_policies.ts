import { call_only_mails_the_workspace } from '@coworker/core/access/mail_to_yourself';
import {
  grant_covers_call,
  type PolicyGrant,
  read_policy_grant,
} from '@coworker/core/access/policy_grants';
import {
  combine_scope_decisions,
  type PolicyScopeDecision,
  resolve_policy_mode_by_scope,
} from '@coworker/core/access/policy_modes';
import {
  policy_scope_refs,
  read_policy_scope_ids,
} from '@coworker/core/access/policy_scope_context';
import {
  build_tool_policy_resources,
  built_in_policy_rules,
} from '@coworker/core/access/tool_policy_resources';
import type { Database } from '@coworker/core/db/connection';
import {
  count_tool_calls_today,
  list_applicable_policies,
} from '@coworker/core/db/queries/policies';
import type {
  ApprovalPolicyData,
  NodeMetadataData,
} from '@coworker/core/db/schema/json_column_types';
import type { PolicyMode } from '@coworker/core/db/schema/policies';

export type ToolPolicyTarget = {
  node_key: string;
  connection_id?: string | null;
  approval_policy: ApprovalPolicyData | null | undefined;
  metadata: NodeMetadataData | null | undefined;
  tool_input?: unknown;
};

export type ToolPolicyContext = {
  workspace_id: string;
  session_id?: string;
  agent_id?: string;
  actor_id: string;
  acting_actor_id?: string;
  automation_id?: string | null;
};

export async function resolve_tool_policy_scope_decisions(
  db: Database,
  input: ToolPolicyContext & { tools: readonly ToolPolicyTarget[] },
): Promise<Map<string, PolicyScopeDecision[]>> {
  const connection_ids = input.tools.flatMap((tool) =>
    tool.connection_id ? [tool.connection_id] : [],
  );
  const scopes = await read_policy_scope_ids(db, { ...input, connection_ids });
  const resources_by_node = new Map(
    input.tools.map((tool) => [tool.node_key, build_tool_policy_resources(tool)]),
  );
  const written_rules = await list_applicable_policies(db, {
    workspace_id: input.workspace_id,
    resources: unique_resources([...resources_by_node.values()].flat()),
    scopes: policy_scope_refs(scopes),
  });
  const built_in = built_in_policy_rules(input.workspace_id);
  const read_grant = await prepare_grant_reader(db, input.workspace_id, written_rules);

  return new Map(
    input.tools.map((tool) => [
      tool.node_key,
      resolve_policy_mode_by_scope({
        rules: [...written_rules.filter((rule) => read_grant(rule, input, tool)), ...built_in],
        resources: resources_by_node.get(tool.node_key) ?? [],
        scopes: { ...scopes, connection: tool.connection_id ? [tool.connection_id] : [] },
      }),
    ]),
  );
}

type WrittenRule = Awaited<ReturnType<typeof list_applicable_policies>>[number];

async function prepare_grant_reader(
  db: Database,
  workspace_id: string,
  written_rules: readonly WrittenRule[],
) {
  const now = new Date();
  const grants = new Map<string, PolicyGrant>();
  for (const rule of written_rules) {
    const grant = read_policy_grant(rule.metadata);
    if (grant && rule.policy_mode === 'allow') grants.set(rule.policy_id, grant);
  }
  const calls_today = new Map(
    await Promise.all(
      [...grants]
        .filter(([, grant]) => grant.max_per_day !== undefined)
        .map(
          async ([policy_id]) =>
            [
              policy_id,
              await count_tool_calls_today(db, {
                workspace_id,
                node_key: node_key_of(written_rules, policy_id),
                since: start_of_today(now),
              }),
            ] as const,
        ),
    ),
  );

  return (rule: WrittenRule, context: ToolPolicyContext, tool: ToolPolicyTarget) => {
    const grant = grants.get(rule.policy_id);
    if (!grant) return true;
    return grant_covers_call(grant, {
      now,
      automation_id: context.automation_id ?? null,
      tool_input: tool.tool_input,
      calls_today: calls_today.get(rule.policy_id) ?? 0,
    });
  };
}

function node_key_of(written_rules: readonly WrittenRule[], policy_id: string) {
  return written_rules.find((rule) => rule.policy_id === policy_id)?.resource_id ?? '';
}

// The day boundary is UTC. Move it to the workspace timezone when a cap straddling
// midnight somewhere else is a real complaint.
function start_of_today(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function resolve_tool_policy_modes(
  db: Database,
  input: ToolPolicyContext & { tools: readonly ToolPolicyTarget[] },
): Promise<Map<string, PolicyMode>> {
  const decisions = await resolve_tool_policy_scope_decisions(db, input);
  const modes = new Map(
    [...decisions].map(([node_key, scopes]) => [node_key, combine_scope_decisions(scopes)]),
  );
  for (const tool of input.tools) {
    if (modes.get(tool.node_key) !== 'ask') continue;
    const own = await call_only_mails_the_workspace(db, {
      workspace_id: input.workspace_id,
      tool_input: tool.tool_input,
    });
    if (own) modes.set(tool.node_key, 'allow');
  }
  return modes;
}

export async function resolve_tool_policy_mode(
  db: Database,
  input: ToolPolicyContext & { tool: ToolPolicyTarget },
) {
  const modes = await resolve_tool_policy_modes(db, { ...input, tools: [input.tool] });
  return modes.get(input.tool.node_key) ?? 'allow';
}

function unique_resources<T extends { resource_type: string; resource_id: string }>(
  resources: T[],
) {
  return [
    ...new Map(
      resources.map((resource) => [`${resource.resource_type}:${resource.resource_id}`, resource]),
    ).values(),
  ];
}
