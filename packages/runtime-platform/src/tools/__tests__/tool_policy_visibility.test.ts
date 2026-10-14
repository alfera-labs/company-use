import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { set_policy } from '@coworker/core/db/queries/policies';
import { create_session } from '@coworker/core/db/queries/sessions';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { runtime_search_tools_tool } from '@runtime-platform/tools/definitions/runtime_search_tools';
import { find_hidden_runtime_tool_names } from '@runtime-platform/tools/policies/runtime_tool_policy_visibility';
import { get_tool_schema } from '@runtime-platform/tools/tool_schema';
import { describe, expect, it } from 'vitest';

describe('tool policy visibility', () => {
  it('removes never from search and direct schema lookup', async () => {
    const { db, bootstrap, session, context } = await visibility_fixture();
    const before = await search(context);
    expect(tool_keys(before)).toContain('slack-read_history-1');

    await set_policy(db, {
      workspace_id: bootstrap.workspace_id,
      resource_type: 'node',
      resource_id: 'slack-read_history-1',
      scope_type: 'workspace',
      scope_id: bootstrap.workspace_id,
      policy_mode: 'never',
      actor_id: bootstrap.user_id,
    });

    const after = await search(context);
    expect(tool_keys(after)).not.toContain('slack-read_history-1');
    const hidden_runtime_tools = await find_hidden_runtime_tool_names(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
      source_context: { source_type: 'dashboard' },
    });
    expect(hidden_runtime_tools).toContain('slack-read_history-1');
    const schema = await get_tool_schema(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
      node_key: 'slack-read_history-1',
    });
    expect(schema).toMatchObject({ error: { code: 'tool_not_found' } });
  });
});

async function visibility_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const context = {
    db,
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: 'run_visibility',
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  };
  return { db, bootstrap, session, context };
}

function search(context: Parameters<typeof runtime_search_tools_tool.execute>[1]) {
  return runtime_search_tools_tool.execute(
    { query: 'read history', max_results: 50, offset: 0 },
    context,
  );
}

function tool_keys(result: Awaited<ReturnType<typeof search>>) {
  if (!result.success) return [];
  const tools = (result.data as { tools: Array<{ node_key: string }> }).tools;
  return tools.map((tool) => tool.node_key);
}
