import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { claim_card_unlock } from '@coworker/core/db/queries/rewards_state';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { connections, events } from '@coworker/core/db/schema';
import { scout_actor, scout_config_key } from '@coworker/shared';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack_sdk = vi.hoisted(() => ({ conversations_replies: vi.fn() }));

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    conversations = { replies: slack_sdk.conversations_replies };
  },
}));

const { create_scheduled_task_tool } = await import(
  '@runtime-platform/tools/definitions/scheduled_tasks'
);

describe('a scheduled task the scout creates', () => {
  beforeEach(() => {
    slack_sdk.conversations_replies.mockReset();
  });

  it('stores the Slack source on a task created by the scout', async () => {
    const source_event_id = 'evt_scout_schedule_source';
    const context = await create_runtime_context({
      actor_id: scout_actor,
      source_context: {
        source_type: 'runtime',
        source_metadata: { [scout_config_key]: { observed_event_ids: [source_event_id] } },
      },
    });
    await seed_slack_connection(context.db, context.workspace_id);
    await context.db.insert(events).values({
      event_id: source_event_id,
      workspace_id: context.workspace_id,
      source: 'slack',
      source_event_id: 'Ev_HEARTBEAT_SCHEDULE',
      event_type: 'message',
      queue_key: 'slack:T_TZ:C_SOURCE:thread:1700000000.000100',
      actor_key: 'slack:T_TZ:U_REQUESTER',
      event_body: {
        team_id: 'T_TZ',
        channel_id: 'C_SOURCE',
        event_ts: '1700000000.000100',
        user_id: 'U_REQUESTER',
        raw_text: 'Please prepare the report.',
      },
      created_by: 'test',
      last_updated_by: 'test',
    });
    slack_sdk.conversations_replies.mockResolvedValue({
      ok: true,
      messages: [
        { ts: '1700000000.000100', user: 'U_REQUESTER', text: 'Please prepare the report.' },
      ],
    });

    const result = await create_scheduled_task_tool.execute(
      {
        name: 'Scout report',
        instruction: 'Prepare the requested report.',
        run_once_at: '2026-07-14T09:00:00.000Z',
        timezone: 'Europe/London',
        source_event_id,
      },
      context,
    );
    const [trigger] = await context.db.query.triggers.findMany();

    expect(result).toMatchObject({ success: true });
    expect(trigger?.trigger_source).toMatchObject({
      [scout_config_key]: {
        source_event_id,
        observed_event_ids: [source_event_id],
      },
    });
  });
});

async function create_runtime_context(
  input: Pick<RuntimeToolExecutionContext, 'actor_id' | 'source_context'> | undefined = undefined,
): Promise<RuntimeToolExecutionContext> {
  const db = await create_test_database();
  const workspace = await provision_workspace_for_identity(db, {
    provider_key: 'workos',
    provider_user_id: 'user_tool',
    organization_id: 'org_tool',
    email: 'tool@example.com',
    first_name: 'Tool',
    last_name: 'User',
  });
  await claim_card_unlock(db, workspace.workspace_id);

  return {
    db,
    workspace_id: workspace.workspace_id,
    session_id: 'ses_tool',
    run_id: 'run_tool',
    agent_id: workspace.agent_id,
    actor_id: input?.actor_id ?? workspace.user_id,
    ...(input?.source_context ? { source_context: input.source_context } : {}),
  };
}

async function seed_slack_connection(db: RuntimeToolExecutionContext['db'], workspace_id: string) {
  await db.insert(connections).values({
    connection_id: 'conn_tz_test_slack',
    workspace_id,
    app_id: 'app_slack_test',
    connection_name: 'Slack timezone test',
    connection_status: 'active',
    connection_key: 'native:slack:tz-test',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T_TZ',
    external_account_name: 'Timezone test workspace',
    authorized_scopes: ['chat:write'],
    health_status: 'healthy',
    credentials: { bot_token: 'tz-test-bot-token' },
    provider_account: { team_id: 'T_TZ' },
    metadata: {},
    created_by: 'user_tool',
    last_updated_by: 'user_tool',
  });
}
