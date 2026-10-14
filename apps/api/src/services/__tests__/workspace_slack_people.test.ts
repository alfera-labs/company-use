import { list_workspace_slack_people } from '@api/services/workspace_slack_people';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { connections } from '@coworker/core/db/schema';
import {
  clear_slack_user_directory_cache,
  load_slack_user_directory,
  type SlackMember,
} from '@runtime-platform/channels/slack/directory';
import { beforeEach, describe, expect, it } from 'vitest';

const bot_token = 'slack-people-service-test-token';

type TestDatabase = Awaited<ReturnType<typeof create_test_database>>;

async function create_workspace(db: TestDatabase) {
  return bootstrap_default_workspace(db);
}

async function connect_slack(
  db: TestDatabase,
  workspace: Awaited<ReturnType<typeof bootstrap_default_workspace>>,
  overrides: Partial<typeof connections.$inferInsert> = {},
) {
  await db.insert(connections).values({
    connection_id: 'conn_slack_people',
    workspace_id: workspace.workspace_id,
    app_id: 'app_slack_people',
    connection_name: 'Slack people test',
    connection_status: 'active',
    connection_key: 'native:slack:people-test',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T_PEOPLE',
    external_account_name: 'People workspace',
    authorized_scopes: ['users:read', 'users:read.email'],
    health_status: 'healthy',
    credentials: { bot_token },
    provider_account: { team_id: 'T_PEOPLE' },
    metadata: {},
    created_by: workspace.user_id,
    last_updated_by: workspace.user_id,
    ...overrides,
  });
}

function slack_member(overrides: Partial<SlackMember> & { user_id: string }): SlackMember {
  return {
    real_name: null,
    display_name: null,
    email: null,
    timezone: null,
    is_bot: false,
    is_guest: false,
    ...overrides,
  };
}

async function slack_directory_holds(members: SlackMember[]) {
  await load_slack_user_directory(bot_token, Date.now(), async () => ({
    members,
    name_by_id: new Map(),
    truncated: false,
    loaded_pages: 1,
  }));
}

beforeEach(() => {
  clear_slack_user_directory_cache();
});

describe('list_workspace_slack_people', () => {
  it('says Slack is not connected when the workspace has no Slack connection', async () => {
    const db = await create_test_database();
    const workspace = await create_workspace(db);

    const result = await list_workspace_slack_people(db, workspace.workspace_id);

    expect(result).toEqual({ connected: false, people: [] });
  });

  it('treats a Slack connection that is no longer active as not connected', async () => {
    const db = await create_test_database();
    const workspace = await create_workspace(db);
    await connect_slack(db, workspace, { connection_status: 'revoked' });
    await slack_directory_holds([slack_member({ user_id: 'U1', real_name: 'Nina Boro' })]);

    const result = await list_workspace_slack_people(db, workspace.workspace_id);

    expect(result).toEqual({ connected: false, people: [] });
  });

  it('lists the people in Slack with their name, email, and whether they are a guest', async () => {
    const db = await create_test_database();
    const workspace = await create_workspace(db);
    await connect_slack(db, workspace);
    await slack_directory_holds([
      slack_member({ user_id: 'U1', real_name: 'Nina Boro', email: 'Nina@Northwind.com' }),
      slack_member({
        user_id: 'U2',
        display_name: 'dana',
        email: 'dana@agency.com',
        is_guest: true,
      }),
      slack_member({ user_id: 'U3', email: 'only-email@northwind.com' }),
      slack_member({ user_id: 'U4' }),
    ]);

    const result = await list_workspace_slack_people(db, workspace.workspace_id);

    expect(result).toEqual({
      connected: true,
      people: [
        { slack_user_id: 'U1', name: 'Nina Boro', email: 'Nina@Northwind.com', is_guest: false },
        { slack_user_id: 'U2', name: 'dana', email: 'dana@agency.com', is_guest: true },
        {
          slack_user_id: 'U3',
          name: 'only-email@northwind.com',
          email: 'only-email@northwind.com',
          is_guest: false,
        },
        { slack_user_id: 'U4', name: 'U4', email: null, is_guest: false },
      ],
    });
  });

  it('leaves out bots', async () => {
    const db = await create_test_database();
    const workspace = await create_workspace(db);
    await connect_slack(db, workspace);
    await slack_directory_holds([
      slack_member({ user_id: 'U1', real_name: 'Nina Boro', email: 'nina@northwind.com' }),
      slack_member({ user_id: 'UBOT', real_name: 'Deploy Bot', is_bot: true }),
    ]);

    const result = await list_workspace_slack_people(db, workspace.workspace_id);

    expect(result.people.map((person) => person.slack_user_id)).toEqual(['U1']);
  });

  it('reports a failed lookup and does not throw when the connection holds no bot token', async () => {
    const db = await create_test_database();
    const workspace = await create_workspace(db);
    await connect_slack(db, workspace, { credentials: {} });

    const result = await list_workspace_slack_people(db, workspace.workspace_id);

    expect(result).toEqual({ connected: true, people: [], lookup_failed: true });
  });
});
