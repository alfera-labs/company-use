import type { Participants } from '@coworker/core/access/may_use_resource';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  resolve_catalog_tool,
  resolve_catalog_tools,
  search_tool_catalog,
} from '@coworker/core/db/queries/catalog';
import { restrict_connection_to_one_person } from '@coworker/core/db/queries/connection_people';
import { connections } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { beforeEach, describe, expect, it } from 'vitest';

describe('connection access resolution', () => {
  const slack_node_key = 'slack-read_history-1';
  let db: Awaited<ReturnType<typeof create_test_database>>;
  let workspace_id: string;
  let app_id: string;

  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    await seed_runtime_tool_catalog(db);
    const slack_app = await db.query.apps.findFirst({
      where: (table, { eq }) => eq(table.app_name, 'slack'),
    });
    if (!slack_app) throw new Error('Slack app seed missing');
    app_id = slack_app.app_id;
  });

  function present(user_id: string): Participants {
    return { project: [], agent: [], user: [user_id] };
  }

  function restrict_to(connection_id: string, user_id: string) {
    return restrict_connection_to_one_person(db, { workspace_id, connection_id, user_id });
  }

  async function insert_connection(input: { connection_id: string }) {
    await db.insert(connections).values({
      connection_id: input.connection_id,
      workspace_id,
      app_id,
      connection_key: `native:slack:${input.connection_id}`,
      connection_name: input.connection_id,
      connection_status: 'active',
      provider_key: 'native',
      provider_config_key: 'native:slack',
      provider_config_version: 1,
      connection_profile_key: 'native:slack:oauth_bot',
      connection_profile_version: 1,
      auth_method_key: 'slack_oauth2_bot',
      external_account_id: `T_${input.connection_id}`,
      authorized_scopes: ['channels:read'],
      health_status: 'healthy',
      connection_config: {},
      created_by: 'test',
      last_updated_by: 'test',
    });
  }

  it("hides a teammate's restricted connection and lets the named person reach it", async () => {
    await insert_connection({ connection_id: 'conn_restricted_alice' });
    await restrict_to('conn_restricted_alice', 'user_alice');

    const as_alice = await resolve_catalog_tool(db, {
      workspace_id,
      node_key: slack_node_key,
      participants: present('user_alice'),
    });
    expect(as_alice.connection?.connection_id).toBe('conn_restricted_alice');
    expect(as_alice.access_denied).toBe(false);

    const as_bob = await resolve_catalog_tool(db, {
      workspace_id,
      node_key: slack_node_key,
      participants: present('user_bob'),
    });
    expect(as_bob.connection).toBeNull();
    expect(as_bob.access_denied).toBe(true);

    const as_system = await resolve_catalog_tool(db, {
      workspace_id,
      node_key: slack_node_key,
    });
    expect(as_system.connection).toBeNull();
    expect(as_system.access_denied).toBe(true);
  });

  it('lets any user and an unattributed run reach a shared connection', async () => {
    await insert_connection({ connection_id: 'conn_shared_team' });

    for (const user_id of ['user_alice', 'user_bob', undefined]) {
      const resolved = await resolve_catalog_tool(db, {
        workspace_id,
        node_key: slack_node_key,
        ...(user_id ? { participants: present(user_id) } : {}),
      });
      expect(resolved.connection?.connection_id).toBe('conn_shared_team');
    }
  });

  it("keeps a shared connection reachable by a teammate even when someone else's is restricted", async () => {
    await insert_connection({ connection_id: 'conn_shared_team' });
    await insert_connection({ connection_id: 'conn_restricted_bob' });
    await restrict_to('conn_restricted_bob', 'user_bob');

    const as_alice = await resolve_catalog_tool(db, {
      workspace_id,
      node_key: slack_node_key,
      participants: present('user_alice'),
    });
    expect(as_alice.connection?.connection_id).toBe('conn_shared_team');

    const bob_restricted = await resolve_catalog_tool(db, {
      workspace_id,
      node_key: slack_node_key,
      participants: present('user_bob'),
      connection_id: 'conn_restricted_bob',
    });
    expect(bob_restricted.connection?.connection_id).toBe('conn_restricted_bob');
  });

  it('applies the same access policy to search results in bulk', async () => {
    await insert_connection({ connection_id: 'conn_restricted_alice' });
    await restrict_to('conn_restricted_alice', 'user_alice');
    const tools = await search_tool_catalog(db, {
      workspace_id,
      query: 'Slack',
      limit: 50,
    });
    const connection_tools = tools.filter((tool) => tool.connection_profile_key !== null);
    expect(connection_tools.length).toBeGreaterThan(1);

    const as_alice = await resolve_catalog_tools(db, {
      workspace_id,
      tools: connection_tools,
      participants: present('user_alice'),
    });
    const as_bob = await resolve_catalog_tools(db, {
      workspace_id,
      tools: connection_tools,
      participants: present('user_bob'),
    });

    expect(
      as_alice.every(
        (resolution) => resolution.connection?.connection_id === 'conn_restricted_alice',
      ),
    ).toBe(true);
    expect(
      as_bob.every((resolution) => resolution.connection === null && resolution.access_denied),
    ).toBe(true);
  });
});
