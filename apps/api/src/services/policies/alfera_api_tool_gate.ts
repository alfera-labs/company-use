import { key_authed_route } from '@api/lib/api_key_auth';
import type { ApiEnv } from '@api/lib/context';
import type { Database } from '@coworker/core';
import {
  combine_scope_decisions,
  type PolicyScopeDecision,
} from '@coworker/core/access/policy_modes';
import { resolve_tool_policy_scope_decisions } from '@coworker/core/access/resolve_tool_policies';
import { node_rule_specificity } from '@coworker/core/access/tool_policy_resources';
import { find_or_create_alfera_api_connection } from '@coworker/core/db/queries/alfera_api_connection';
import type { ApiKey, ApiKeyScope } from '@coworker/core/db/queries/api_keys';
import type { PolicyMode, PolicyScopeType } from '@coworker/core/db/schema/policies';
import {
  type AlferaApiTool,
  alfera_api_display_name,
  alfera_api_tool_policy_labels,
  build_alfera_api_node_key,
  find_alfera_api_tool,
} from '@coworker/core/integrations/alfera_api_tools';
import { AppError } from '@coworker/shared';
import type { Context } from 'hono';

export async function assert_alfera_api_tool_allowed(
  db: Database,
  api_key: ApiKey,
  tool_name: string,
) {
  const tool = find_alfera_api_tool(tool_name);
  if (!tool) throw new Error(`Alfera API tool is not in the registry: ${tool_name}`);
  const connection = await find_or_create_alfera_api_connection(db, api_key.workspace_id);
  const node_key = build_alfera_api_node_key(tool_name);
  const decisions = await resolve_tool_policy_scope_decisions(db, {
    workspace_id: api_key.workspace_id,
    actor_id: api_key.api_key_id,
    tools: [
      {
        node_key,
        connection_id: connection.connection_id,
        approval_policy: null,
        metadata: { policy_labels: alfera_api_tool_policy_labels(tool) },
      },
    ],
  });
  const scopes = (decisions.get(node_key) ?? []).filter(
    (scope) => !the_key_is_the_answer_to_this_ask(tool, scope),
  );
  const mode = combine_scope_decisions(scopes);
  if (mode === 'allow') return;
  throw build_refusal({
    tool_name,
    node_key,
    mode,
    scopes,
    connection_id: connection.connection_id,
  });
}

function the_key_is_the_answer_to_this_ask(tool: AlferaApiTool, scope: PolicyScopeDecision) {
  return (
    tool.group_key === 'sessions' &&
    scope.mode === 'ask' &&
    scope.scope_type === 'workspace' &&
    scope.specificity < node_rule_specificity
  );
}

export function key_authed_tool_route(
  required_scope: ApiKeyScope,
  tool_name: string,
  handler: (c: Context<ApiEnv>, api_key: ApiKey) => Promise<Response>,
) {
  return key_authed_route(required_scope, async (c, api_key) => {
    await assert_alfera_api_tool_allowed(c.get('db'), api_key, tool_name);
    return handler(c, api_key);
  });
}

const scope_names: Record<PolicyScopeType, string> = {
  workspace: 'a workspace rule',
  connection: `the ${alfera_api_display_name} connection's rule`,
  project: 'a project rule',
  agent: 'an agent rule',
  user: 'a rule on this API key',
};

function build_refusal(input: {
  tool_name: string;
  node_key: string;
  mode: Exclude<PolicyMode, 'allow'>;
  scopes: readonly PolicyScopeDecision[];
  connection_id: string;
}) {
  const deciding = input.scopes.filter((scope) => scope.mode === input.mode);
  const where = deciding.map((scope) => scope_names[scope.scope_type]).join(' and ');
  const settings = `Settings → Integrations → ${alfera_api_display_name}`;
  const details = {
    tool: input.tool_name,
    node_key: input.node_key,
    policy_mode: input.mode,
    decided_by: deciding.map(({ scope_type, scope_id }) => ({ scope_type, scope_id })),
    connection_id: input.connection_id,
  };
  if (input.mode === 'never') {
    return new AppError(
      'tool_blocked_by_workspace_policy',
      `${input.tool_name} is set to Never allow by ${where}, so it did not run. A workspace owner can change it in ${settings}.`,
      403,
      details,
    );
  }
  return new AppError(
    'approval_required',
    `${input.tool_name} is set to Ask each time by ${where}. A key-authed call has nobody to ask mid-request, so it did not run. A workspace owner can set it to Always allow in ${settings}, or ask an agent to do it in a session, where the step waits for a person's approval.`,
    403,
    details,
  );
}
