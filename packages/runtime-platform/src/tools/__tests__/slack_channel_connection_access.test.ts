import { build_participants } from '@coworker/core/access/build_participants';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { resolve_catalog_tool } from '@coworker/core/db/queries/catalog';
import { create_project } from '@coworker/core/db/queries/projects';
import { replace_resource_sharing } from '@coworker/core/db/queries/resource_grants';
import { connections } from '@coworker/core/db/schema';
import type {
  SessionMetadata,
  SessionSourceMetadataData,
} from '@coworker/core/db/schema/json_column_types';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { describe, expect, it } from 'vitest';

// #sales works in Sales. Rob's own connection is shared "Only Rob". In #sales the agent may use
// what Sales was given and never Rob's own connection, even when Rob is the only one typing: the
// rest of the channel reads the answer. In his DM, his own connection works. Asked through the
// path a tool call actually takes (resolve_catalog_tool), with the source metadata a real Slack
// session stores.

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const slack_app = await db.query.apps.findFirst({
    where: (table, { eq }) => eq(table.app_name, 'slack'),
  });
  if (!slack_app) throw new Error('Slack app missing');
  const sales = await create_project(db, {
    workspace_id: bootstrap.workspace_id,
    project_name: 'Sales',
    owner_id: bootstrap.user_id,
    actor_id: bootstrap.user_id,
  });
  const own_room = await db.query.projects.findFirst({
    where: (table, { eq }) => eq(table.personal_for_user_id, bootstrap.user_id),
  });
  if (!own_room) throw new Error('the bootstrapped workspace has no personal room');

  // Rob connected his own; the sales lead connected the team's. A person keeps what they connected
  // in their own room, so who connected each one matters for the DM case below.
  for (const [connection_id, connected_by] of [
    ['conn_robs_own', bootstrap.user_id],
    ['conn_sales', 'user_sales_lead'],
  ] as const) {
    await db.insert(connections).values({
      connection_id,
      workspace_id: bootstrap.workspace_id,
      app_id: slack_app.app_id,
      connection_key: `native:slack:${connection_id}`,
      connection_name: connection_id,
      connection_status: 'active',
      provider_key: 'native',
      provider_config_key: 'native:slack',
      provider_config_version: 1,
      connection_profile_key: 'native:slack:oauth_bot',
      connection_profile_version: 1,
      auth_method_key: 'slack_oauth2_bot',
      external_account_id: `T_${connection_id}`,
      authorized_scopes: ['channels:read'],
      health_status: 'healthy',
      connection_config: {},
      connected_by,
      created_by: connected_by,
      last_updated_by: connected_by,
    });
  }
  // "Only Rob" and "the Sales project", written the way the sharing menu writes them.
  await replace_resource_sharing(db, {
    workspace_id: bootstrap.workspace_id,
    resource_type: 'connection',
    resource_id: 'conn_robs_own',
    shared_with: [{ grantee_type: 'user', grantee_id: bootstrap.user_id, grant_level: 'use' }],
    actor_id: bootstrap.user_id,
  });
  await replace_resource_sharing(db, {
    workspace_id: bootstrap.workspace_id,
    resource_type: 'connection',
    resource_id: 'conn_sales',
    shared_with: [{ grantee_type: 'project', grantee_id: sales.project_id, grant_level: 'use' }],
    actor_id: bootstrap.user_id,
  });
  return { db, bootstrap, sales, own_room };
}

function rob_is_the_only_speaker(fixture: Fixture): SessionMetadata {
  return {
    actors: [
      {
        source_actor_id: 'sactor_rob',
        actor_kind: 'platform_user',
        platform_user_id: fixture.bootstrap.user_id,
        external_ids: [],
        profile: {},
        first_seen_time: '2026-09-27T00:00:00Z',
        last_seen_time: '2026-09-27T00:00:00Z',
        message_count: 1,
      },
    ],
  } as SessionMetadata;
}

function resolve_for(
  fixture: Fixture,
  input: {
    connection_id: string;
    project_id: string;
    room_private_to: string | null;
    source: SessionSourceMetadataData;
  },
) {
  return resolve_catalog_tool(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    node_key: 'slack-read_history-1',
    connection_id: input.connection_id,
    participants: build_participants({
      project_id: input.project_id,
      session_metadata: rob_is_the_only_speaker(fixture),
      session_source_metadata: input.source,
      agent_ids: [fixture.bootstrap.agent_id],
    }),
    room_private_to: input.room_private_to,
  });
}

const in_sales_channel: SessionSourceMetadataData = {
  slack: { team_id: 'T_ACME', channel_id: 'C_SALES', channel_type: 'channel' },
};
const in_robs_dm: SessionSourceMetadataData = {
  slack: { team_id: 'T_ACME', channel_id: 'D_ROB', channel_type: 'im' },
};

describe('connections in a Slack channel that works in a project', () => {
  it("never uses Rob's own connection in #sales, even when he is the only one typing", async () => {
    const fixture = await create_fixture();
    const verdict = await resolve_for(fixture, {
      connection_id: 'conn_robs_own',
      project_id: fixture.sales.project_id,
      room_private_to: null,
      source: in_sales_channel,
    });
    expect(verdict).toMatchObject({ connection: null, access_denied: true });
  });

  it('uses what the Sales project was given in #sales', async () => {
    const fixture = await create_fixture();
    const verdict = await resolve_for(fixture, {
      connection_id: 'conn_sales',
      project_id: fixture.sales.project_id,
      room_private_to: null,
      source: in_sales_channel,
    });
    expect(verdict.connection?.connection_id).toBe('conn_sales');
  });

  it("uses Rob's own connection in his DM, and not the Sales one", async () => {
    const fixture = await create_fixture();
    const in_dm = (connection_id: string) =>
      resolve_for(fixture, {
        connection_id,
        project_id: fixture.own_room.project_id,
        room_private_to: fixture.bootstrap.user_id,
        source: in_robs_dm,
      });
    expect((await in_dm('conn_robs_own')).connection?.connection_id).toBe('conn_robs_own');
    expect(await in_dm('conn_sales')).toMatchObject({ connection: null, access_denied: true });
  });
});
