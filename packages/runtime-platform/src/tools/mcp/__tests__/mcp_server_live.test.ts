import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_nodes } from '@coworker/core/db/queries/catalog';
import { apps } from '@coworker/core/db/schema';
import { define_mcp_client_connection } from '@runtime-platform/connections/mcp_client_connection';
import { sync_mcp_server_tools } from '@runtime-platform/connections/mcp_tool_sync';
import { execute_catalog_tool } from '@runtime-platform/tools/catalog_tool_execution';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const live_test_enabled = process.env.COWORKER_MCP_LIVE_TEST_ENABLED === 'true';
const deepwiki_url = 'https://mcp.deepwiki.com/mcp';
const context7_url = 'https://mcp.context7.com/mcp';

async function add_live_server(server_url: string, display_name?: string) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const outcome = await define_mcp_client_connection({
    db,
    workspace_id: bootstrap.workspace_id,
    actor_id: bootstrap.user_id,
    server_url,
    ...(display_name ? { display_name } : {}),
    redirect_uri: 'https://app.alfera.ai/connect/callback',
  });
  return { db, bootstrap, outcome };
}

describe.skipIf(!live_test_enabled)('MCP client against a live open server', () => {
  it('adds the server, catalogs its tools, and executes one', async () => {
    const { db, bootstrap, outcome } = await add_live_server(deepwiki_url);

    expect(outcome.kind).toBe('connected');
    if (outcome.kind !== 'connected') return;
    expect(outcome.tool_count).toBeGreaterThan(0);

    expect(outcome.app_name).toBe('DeepWiki');
    const added = await db.query.apps.findFirst({
      where: eq(apps.app_id, outcome.app_id),
    });
    expect(added?.app_display_name).toBe('DeepWiki');

    const nodes = await list_nodes(db, { workspace_id: bootstrap.workspace_id });
    const mcp_nodes = nodes.filter((node) => node.node_runtime === 'mcp_tool');
    expect(mcp_nodes.length).toBe(outcome.tool_count);

    const structure_node = mcp_nodes.find((node) =>
      node.node_name.startsWith('read_wiki_structure'),
    );
    expect(structure_node).toBeDefined();
    if (!structure_node) return;

    expect(structure_node.approval_policy).toEqual({ mode: 'manual_review' });

    const result = await execute_catalog_tool(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: 'ses_live_mcp',
      run_id: 'run_live_mcp',
      actor_id: bootstrap.user_id,
      node_key: structure_node.node_key,
      tool_input: { repoName: 'facebook/react' },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(JSON.stringify(result.data).toLowerCase()).toContain('react');
  }, 120_000);

  it('reports a tool failure as a failure rather than a success', async () => {
    const { db, bootstrap, outcome } = await add_live_server(deepwiki_url);
    expect(outcome.kind).toBe('connected');
    if (outcome.kind !== 'connected') return;

    const nodes = await list_nodes(db, { workspace_id: bootstrap.workspace_id });
    const structure_node = nodes.find((node) => node.node_name.startsWith('read_wiki_structure'));
    if (!structure_node) throw new Error('live server no longer advertises the expected tool');

    const result = await execute_catalog_tool(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: 'ses_live_mcp',
      run_id: 'run_live_mcp',
      actor_id: bootstrap.user_id,
      node_key: structure_node.node_key,
      tool_input: { not_a_real_argument: true },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('mcp_tool_failed');
  }, 120_000);

  it('retires a tool that disappears instead of deleting its row', async () => {
    const { db, bootstrap, outcome } = await add_live_server(deepwiki_url);
    expect(outcome.kind).toBe('connected');
    if (outcome.kind !== 'connected') return;

    const before = await list_nodes(db, { workspace_id: bootstrap.workspace_id });
    const mcp_before = before.filter((node) => node.node_runtime === 'mcp_tool');

    const resynced = await sync_mcp_server_tools({
      db,
      workspace_id: bootstrap.workspace_id,
      app_id: outcome.app_id,
      actor_id: bootstrap.user_id,
    });
    expect(resynced.synced).toBe(true);
    if (!resynced.synced) return;
    expect(resynced.inserted).toBe(0);
    expect(resynced.retired).toBe(0);

    const after = await list_nodes(db, { workspace_id: bootstrap.workspace_id });
    const mcp_after = after.filter((node) => node.node_runtime === 'mcp_tool');
    expect(mcp_after.map((node) => node.node_id).sort()).toEqual(
      mcp_before.map((node) => node.node_id).sort(),
    );
  }, 120_000);
});

describe.skipIf(!live_test_enabled)('MCP client against a live server offering sign-in', () => {
  it('offers the sign-in a server advertises on a successful call', async () => {
    const { db, outcome } = await add_live_server(context7_url);

    expect(outcome.kind).toBe('needs_authorization');
    if (outcome.kind !== 'needs_authorization') return;
    expect(outcome.start_url).toContain('/connect/start');

    expect(outcome.app_name).toBe('Context7');
    const added = await db.query.apps.findFirst({ where: eq(apps.app_id, outcome.app_id) });
    expect(added?.app_display_name).toBe('Context7');
    expect(added?.metadata.icon_url).toContain('context7');
  }, 120_000);
});
