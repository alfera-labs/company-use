import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { upsert_source_actor } from '@coworker/core/db/queries/source_actors';
import { runtime_add_mcp_server_tool } from '@runtime-platform/tools/definitions/runtime_add_mcp_server';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34' }] }));

describe('adding an MCP server from chat', () => {
  it('refuses someone who is not a workspace admin, before contacting the server', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const fetch_mock = vi.fn();
    vi.stubGlobal('fetch', fetch_mock);

    const result = await runtime_add_mcp_server_tool.execute(
      { server_url: 'https://mcp.acme.test/mcp' },
      {
        db,
        workspace_id: bootstrap.workspace_id,
        actor_id: 'user_outsider',
      } as RuntimeToolExecutionContext,
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('mcp_server_access_denied');
    expect(fetch_mock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('refuses a Slack speaker who is not a member, even when the installer is an admin', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const speaker = await upsert_source_actor(db, {
      workspace_id: bootstrap.workspace_id,
      provider: 'slack',
      external_id: 'U_GUEST',
      display_name: 'Guest',
      email: 'guest@outside.test',
      actor_id: 'system:test',
    });
    const fetch_mock = vi.fn();
    vi.stubGlobal('fetch', fetch_mock);

    const result = await runtime_add_mcp_server_tool.execute(
      { server_url: 'https://mcp.acme.test/mcp' },
      {
        db,
        workspace_id: bootstrap.workspace_id,
        session_id: 'ses_slack_test',
        run_id: 'run_slack_test',
        actor_id: bootstrap.user_id,
        speaker: { source_actor_id: speaker.source_actor_id, name: 'Guest' },
      } as RuntimeToolExecutionContext,
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('mcp_server_access_denied');
    expect(fetch_mock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('lets a workspace admin asking from the dashboard through the gate', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const fetch_mock = vi.fn(async () => new Response('no', { status: 401 }));
    vi.stubGlobal('fetch', fetch_mock);

    const outcome = await runtime_add_mcp_server_tool
      .execute({ server_url: 'https://mcp.acme.test/mcp' }, {
        db,
        workspace_id: bootstrap.workspace_id,
        session_id: 'ses_dashboard_test',
        run_id: 'run_dashboard_test',
        actor_id: bootstrap.user_id,
      } as RuntimeToolExecutionContext)
      .catch((error: unknown) => error);

    expect(outcome).not.toMatchObject({ error: { code: 'mcp_server_access_denied' } });
    expect(fetch_mock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('never accepts a token, so one cannot arrive in a chat message', () => {
    const properties = runtime_add_mcp_server_tool.input_schema.properties ?? {};
    expect(Object.keys(properties)).toEqual(['server_url', 'display_name']);
    expect(runtime_add_mcp_server_tool.description).toContain('password field');
  });
});
