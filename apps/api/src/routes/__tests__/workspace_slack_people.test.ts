import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { connections, workspace_members } from '@coworker/core/db/schema';
import {
  clear_slack_user_directory_cache,
  load_slack_user_directory,
  type SlackMember,
} from '@runtime-platform/channels/slack/directory';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

const bot_token = 'slack-people-route-test-token';

type TestDatabase = Awaited<ReturnType<typeof create_test_database>>;

async function connect_slack(
  db: TestDatabase,
  credentials: (typeof connections.$inferInsert)['credentials'] = { bot_token },
) {
  const workspace = await bootstrap_default_workspace(db);
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
    credentials,
    provider_account: { team_id: 'T_PEOPLE' },
    metadata: {},
    created_by: workspace.user_id,
    last_updated_by: workspace.user_id,
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

describe('GET /v1/workspace/slack-people', () => {
  it('answers not connected when the workspace has no Slack connection', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = create_app(db);

    const response = await app.request('/v1/workspace/slack-people');
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toEqual({ connected: false, people: [] });
  });

  it('lists the people in Slack for an admin, without bots', async () => {
    const db = await create_test_database();
    await connect_slack(db);
    await slack_directory_holds([
      slack_member({ user_id: 'U1', real_name: 'Nina Boro', email: 'nina@northwind.com' }),
      slack_member({ user_id: 'U2', real_name: 'Dana Agency', is_guest: true }),
      slack_member({ user_id: 'UBOT', real_name: 'Deploy Bot', is_bot: true }),
    ]);
    const app = create_app(db);

    const response = await app.request('/v1/workspace/slack-people');
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toEqual({
      connected: true,
      people: [
        { slack_user_id: 'U1', name: 'Nina Boro', email: 'nina@northwind.com', is_guest: false },
        { slack_user_id: 'U2', name: 'Dana Agency', email: null, is_guest: true },
      ],
    });
  });

  it('answers 200 with lookup_failed when the Slack lookup cannot run', async () => {
    const db = await create_test_database();
    await connect_slack(db, {});
    const app = create_app(db);

    const response = await app.request('/v1/workspace/slack-people');
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toEqual({ connected: true, people: [], lookup_failed: true });
  });

  it.each(['member', 'viewer'])('refuses the %s role', async (role) => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    await db
      .update(workspace_members)
      .set({ member_role: role })
      .where(eq(workspace_members.member_role, 'owner'));
    const app = create_app(db);

    const response = await app.request('/v1/workspace/slack-people');

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'team_access_denied',
        message: 'Managing the team requires workspace admin access',
      },
    });
  });
});
