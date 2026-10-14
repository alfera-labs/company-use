import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_pending_connection_setup } from '@coworker/core/db/queries/connection_management';
import { create_session } from '@coworker/core/db/queries/sessions';
import { apps, connections, sessions } from '@coworker/core/db/schema';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { create_external_source_actor, create_id, id_prefixes } from '@coworker/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const run_queue_jobs_in_the_background = vi.fn();

vi.mock('@coworker/jobs/event_job_runner', async () => {
  const core = await import('@coworker/core/db/queries/events');
  const queue_and_run_event_jobs = async (
    db: Parameters<typeof core.enqueue_event_jobs>[0],
    event: Parameters<typeof core.enqueue_event_jobs>[1],
  ) => {
    const result = await core.enqueue_event_jobs(db, event);
    if (result.event_jobs.length > 0) {
      run_queue_jobs_in_the_background(db, {
        workspace_id: event.workspace_id,
        queue_key: event.queue_key,
      });
    }
    return result;
  };
  return { run_queue_jobs_in_the_background, queue_and_run_event_jobs };
});

const {
  finalize_oauth_connection_with_resume,
  finalize_provider_connection_with_resume,
  start_connection_resume,
} = await import('@runtime-platform/connections/connection_resume_activation');

describe('connection resume activation', () => {
  beforeEach(() => {
    process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'connection-resume-activation-test-key';
    run_queue_jobs_in_the_background.mockClear();
  });

  afterEach(() => {
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  });

  it('enqueues a resume event after Composio provider completion', async () => {
    const fixture = await create_fixture();
    const app = await insert_connectable_app(fixture.db, 'gmail');
    const setup = await create_pending_connection_setup(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: fixture.bootstrap.user_id,
      resume: resume_intent(fixture.session.session_id),
    });

    await finalize_provider_connection_with_resume(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      provider_key: 'composio',
      connection_id: setup.connection.connection_id,
      status: 'success',
      external_account_id: 'apn_gmail',
      actor_id: fixture.bootstrap.user_id,
      setup_state: setup.setup,
    });

    const jobs = await fixture.db.query.event_jobs.findMany({
      where: (table, { eq }) => eq(table.job_handler, 'connection_resume'),
    });
    const events = await fixture.db.query.events.findMany({
      where: (table, { eq }) => eq(table.event_type, 'connection.resume_requested'),
    });
    expect(jobs).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source_event_id: setup.connection.connection_id,
      queue_key: 'slack:T123:C123:thread:1700000000.000001',
    });
    expect(jobs[0]).toMatchObject({
      queue_key: 'slack:T123:C123:thread:1700000000.000001',
    });
    expect(run_queue_jobs_in_the_background).toHaveBeenCalledWith(
      fixture.db,
      expect.objectContaining({
        workspace_id: fixture.bootstrap.workspace_id,
        queue_key: 'slack:T123:C123:thread:1700000000.000001',
      }),
    );
    await start_connection_resume(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      connection_id: setup.connection.connection_id,
      actor_id: fixture.bootstrap.user_id,
      setup_state: setup.setup,
    });

    const resume_jobs = await fixture.db.query.event_jobs.findMany({
      where: (table, { eq }) => eq(table.job_handler, 'connection_resume'),
    });
    expect(resume_jobs).toHaveLength(1);
  });

  it('does not enqueue after completion when setup has no resume intent', async () => {
    const fixture = await create_fixture();
    const app = await insert_connectable_app(fixture.db, 'sheets');
    const setup = await create_pending_connection_setup(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: fixture.bootstrap.user_id,
    });

    await finalize_provider_connection_with_resume(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      provider_key: 'composio',
      connection_id: setup.connection.connection_id,
      status: 'success',
      external_account_id: 'apn_sheets',
      actor_id: fixture.bootstrap.user_id,
      setup_state: setup.setup,
    });

    const jobs = await fixture.db.query.event_jobs.findMany({
      where: (table, { eq }) => eq(table.job_handler, 'connection_resume'),
    });
    expect(jobs).toHaveLength(0);
    expect(run_queue_jobs_in_the_background).not.toHaveBeenCalled();
  });

  it('enqueues a resume event after native OAuth completion', async () => {
    const fixture = await create_fixture();
    const app = await insert_oauth_app(fixture.db, 'calendar');
    const setup = await create_pending_connection_setup(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'native',
      actor_id: fixture.bootstrap.user_id,
      resume: resume_intent(fixture.session.session_id),
    });
    const state_token = (setup.setup as { oauth_state_token?: string } | null)?.oauth_state_token;
    if (!state_token) throw new Error('OAuth state token was not created');

    await finalize_oauth_connection_with_resume(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      state_token,
      status: 'success',
      token_response: { access_token: 'oauth-token', token_type: 'Bearer', expires_in: 3600 },
      actor_id: fixture.bootstrap.user_id,
      setup_state: setup.setup,
    });

    const jobs = await fixture.db.query.event_jobs.findMany({
      where: (table, { eq }) => eq(table.job_handler, 'connection_resume'),
    });
    const events = await fixture.db.query.events.findMany({
      where: (table, { eq }) => eq(table.event_type, 'connection.resume_requested'),
    });
    expect(jobs).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source_event_id: setup.connection.connection_id,
      queue_key: 'slack:T123:C123:thread:1700000000.000001',
    });
    expect(jobs[0]).toMatchObject({
      queue_key: 'slack:T123:C123:thread:1700000000.000001',
    });
  });
});

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await insert_slack_connection(db, bootstrap.workspace_id, bootstrap.user_id);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_source: 'slack',
    external_thread_key: 'slack:T123:C123:thread:1700000000.000001',
    source_metadata: {
      slack: {
        team_id: 'T123',
        channel_id: 'C123',
        thread_ts: '1700000000.000001',
      },
    },
    actor_id: bootstrap.user_id,
  });
  await db
    .update(sessions)
    .set({
      session_metadata: {
        actors: [
          {
            ...create_external_source_actor({
              provider_key: 'slack',
              external_account_id: 'T123',
              external_user_id: 'U123',
              profile: { display_name: 'Robin' },
            }),
            first_seen_time: new Date().toISOString(),
            last_seen_time: new Date().toISOString(),
            message_count: 1,
          },
        ],
      },
    })
    .where(eq(sessions.session_id, session.session_id));
  return { db, bootstrap, session };
}

async function insert_slack_connection(
  db: Awaited<ReturnType<typeof create_test_database>>,
  workspace_id: string,
  actor_id: string,
) {
  const app_id = create_id(id_prefixes.app);
  await db.insert(apps).values({
    app_id,
    app_name: 'slack',
    app_key: 'slack',
    catalog_scope: 'global',
    app_display_name: 'Slack',
    auth_type: 'oauth2',
    app_status: 'active',
    display_config: {},
    metadata: {},
    created_by: 'test',
    last_updated_by: 'test',
  });

  await db.insert(connections).values({
    connection_id: 'conn_slack_resume',
    workspace_id,
    app_id,
    connection_name: 'Slack',
    connection_status: 'active',
    connection_key: 'native:slack:resume',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T123',
    external_account_name: 'Test workspace',
    authorized_scopes: ['chat:write'],
    health_status: 'healthy',
    credentials: encrypt_connection_credentials({
      credential_source: 'oauth2',
      values: { bot_token: 'xoxb-resume' },
    }),
    provider_account: { team_id: 'T123' },
    metadata: {},
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

async function insert_connectable_app(
  db: Awaited<ReturnType<typeof create_test_database>>,
  app_name: string,
) {
  const app_id = create_id(id_prefixes.app);
  const [app] = await db
    .insert(apps)
    .values({
      app_id,
      app_name,
      app_key: app_name,
      catalog_scope: 'global',
      app_display_name: app_name,
      auth_type: 'oauth2',
      app_status: 'active',
      display_config: {},
      metadata: {
        provider_configs: [
          {
            provider_key: 'composio',
            provider_config_key: `composio:${app_name}`,
            version: 1,
            status: 'active',
            provider_app_key: app_name,
            setup_defaults: {},
            connection_profiles: [
              {
                connection_profile_key: `composio:${app_name}:managed_oauth`,
                version: 1,
                status: 'active',
                auth_method_key: 'composio_managed_auth',
                setup_strategy: { type: 'connect_token' },
                runtime_credential_strategy: { type: 'provider_account_reference' },
                default_scopes: [],
              },
            ],
          },
        ],
      },
      created_by: 'test',
      last_updated_by: 'test',
    })
    .returning();
  if (!app) throw new Error('App was not inserted');
  return app;
}

async function insert_oauth_app(
  db: Awaited<ReturnType<typeof create_test_database>>,
  app_name: string,
) {
  const app_id = create_id(id_prefixes.app);
  const [app] = await db
    .insert(apps)
    .values({
      app_id,
      app_name,
      app_key: app_name,
      catalog_scope: 'global',
      app_display_name: app_name,
      auth_type: 'oauth2',
      app_status: 'active',
      display_config: {},
      metadata: {
        provider_configs: [
          {
            provider_key: 'native',
            provider_config_key: `native:${app_name}`,
            version: 1,
            status: 'active',
            provider_app_key: app_name,
            setup_defaults: {},
            connection_profiles: [
              {
                connection_profile_key: `native:${app_name}:oauth`,
                version: 1,
                status: 'active',
                auth_method_key: 'oauth2',
                setup_strategy: {
                  type: 'oauth2_authorization_code',
                  authorization_url: 'https://auth.example.test/oauth',
                  token_url: 'https://auth.example.test/token',
                  client_id: 'client-id',
                  client_secret_env: 'TEST_CLIENT_SECRET',
                  scopes: ['calendar.read'],
                },
                runtime_credential_strategy: { type: 'oauth2_credentials' },
                default_scopes: ['calendar.read'],
              },
            ],
          },
        ],
      },
      created_by: 'test',
      last_updated_by: 'test',
    })
    .returning();
  if (!app) throw new Error('OAuth app was not inserted');
  return app;
}

function resume_intent(session_id: string) {
  return {
    session_id,
    instruction: 'Continue the task after connection.',
    created_at: new Date().toISOString(),
  };
}
