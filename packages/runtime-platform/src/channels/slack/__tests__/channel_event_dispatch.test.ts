import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { list_session_messages } from '@coworker/core/db/queries/sessions';
import { channels, connections, event_jobs } from '@coworker/core/db/schema';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { claim_ready_event_jobs_for_queue, run_queue_jobs } from '@coworker/jobs';
import { dispatch_slack_channel_event } from '@runtime-platform/channels/slack/channel_event_dispatch';
import { upsert_default_slack_channel_for_connection } from '@runtime-platform/channels/slack/channel_setup';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

function find_logged_line(spy: MockInstance, message: string): string {
  const line = spy.mock.calls
    .map((call) => call[0])
    .find((value): value is string => typeof value === 'string' && value.includes(message));
  if (line === undefined) throw new Error(`no logged line contained: ${message}`);
  return line;
}

vi.mock('@agent-core/llm_gateway', async (import_original) => {
  const llm_gateway = await import_original<typeof import('@agent-core/llm_gateway')>();
  const { create_fake_llm_adapter } = await import(
    '@agent-core/llm_gateway/adapters/fake_llm_adapter'
  );
  return {
    ...llm_gateway,
    create_llm_gateway: () =>
      llm_gateway.create_llm_gateway({
        adapter: create_fake_llm_adapter('{"title":"Slack Channel Conversation"}'),
        environment: { OPENAI_API_KEY: 'test-openai-key' },
      }),
  };
});

vi.mock('@agent-core/engines/pi', () => ({
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/slack-dispatch-test',
    async *run() {
      yield {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Dispatched from Slack.' }],
        },
      };
    },
  }),
}));

vi.mock('@runtime-platform/model_resolver', () => ({
  resolve_model: () => ({
    provider: 'openai',
    model_name: 'gpt-test',
    reasoning_level: 'medium',
  }),
}));

const slack_sdk = vi.hoisted(() => ({
  web_client_tokens: [] as string[],
  users_info: vi.fn(),
  chat_post_message: vi.fn(),
  chat_update: vi.fn(),
  chat_stream: vi.fn(),
  reactions_remove: vi.fn(),
  stream_append: vi.fn(),
  stream_stop: vi.fn(),
  api_call: vi.fn(),
  assistant_set_status: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    users = { info: slack_sdk.users_info };
    chat = {
      postMessage: slack_sdk.chat_post_message,
      update: slack_sdk.chat_update,
    };

    reactions = { remove: slack_sdk.reactions_remove };
    chatStream = slack_sdk.chat_stream;
    apiCall = slack_sdk.api_call;
    assistant = { threads: { setStatus: slack_sdk.assistant_set_status } };

    constructor(token: string) {
      slack_sdk.web_client_tokens.push(token);
    }
  },
}));

describe('Slack channel event dispatch', () => {
  beforeEach(() => {
    slack_sdk.chat_stream.mockReturnValue({
      append: slack_sdk.stream_append,
      stop: slack_sdk.stream_stop,
    });
    slack_sdk.stream_append.mockResolvedValue({
      ok: true,
      channel: 'C123',
      ts: '1710000000.000100',
    });
    slack_sdk.stream_stop.mockResolvedValue({
      ok: true,
      channel: 'C123',
      ts: '1710000000.000100',
    });
    slack_sdk.api_call.mockResolvedValue({ ok: true, channel: 'C123', ts: '1710000000.000100' });
    slack_sdk.assistant_set_status.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    slack_sdk.web_client_tokens.length = 0;
    slack_sdk.users_info.mockReset();
    slack_sdk.chat_post_message.mockReset();
    slack_sdk.chat_update.mockReset();
    slack_sdk.chat_stream.mockReset();
    slack_sdk.reactions_remove.mockReset();
    slack_sdk.stream_append.mockReset();
    slack_sdk.stream_stop.mockReset();
    slack_sdk.api_call.mockReset();
    slack_sdk.assistant_set_status.mockReset();
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  });

  it('resolves a Slack app mention through the default channel route into a harness turn', async () => {
    const fixture = await create_fixture();
    slack_sdk.users_info.mockResolvedValue({
      ok: true,
      user: {
        id: 'U123',
        name: 'olivier',
        tz: 'Europe/Rome',
        profile: {
          display_name: 'Olivier',
          real_name: 'Olivier O',
          email: 'founder@runtime.local',
          image_192: 'https://example.test/avatar.png',
        },
      },
    });
    slack_sdk.chat_post_message.mockResolvedValue({
      ok: true,
      channel: 'C123',
      ts: '1710000000.000100',
    });
    slack_sdk.chat_update.mockResolvedValue({ ok: true });

    const result = await dispatch_slack_channel_event(
      fixture.db,
      {
        channel_provider_key: 'slack',
        provider_event_id: 'Ev123',
        received_time: new Date('2026-06-01T10:00:00.000Z'),
        external_account_id: 'T123',
        provider_event_type: 'app_mention',
        raw_event: {
          type: 'event_callback',
          team_id: 'T123',
          event_id: 'Ev123',
          event: {
            type: 'app_mention',
            channel: 'C123',
            channel_type: 'channel',
            user: 'U123',
            ts: '1700000000.000001',
            text: '<@B123> status?',
          },
        },
      },
      { run_options: { workspace_runtime_provider: 'local' } },
    );

    expect(result).toMatchObject({
      dispatched: true,
      workspace_id: fixture.bootstrap.workspace_id,
      connection_id: 'conn_slack_dispatch',
      agent_id: fixture.bootstrap.agent_id,
      channel_id: fixture.default_channel.channel_id,
      turn_finalize: {
        outcome: 'delivered_recovered_reply',
        delivery_duration_ms: expect.any(Number),
      },
    });
    if (!result.dispatched) throw new Error('Slack event was not dispatched');

    const messages = await list_session_messages(
      fixture.db,
      fixture.bootstrap.workspace_id,
      result.session_id,
    );
    expect(messages[0]).toMatchObject({
      message_role: 'user',
      source_type: 'slack',
      content_text: 'status?',
      source_metadata: {
        slack: expect.objectContaining({
          configured_channel_id: fixture.default_channel.channel_id,
          channel_id: 'C123',
          conversation_scope: 'thread',
          thread_ts: '1700000000.000001',
          raw_text: '<@B123> status?',
        }),
        source_actor: expect.objectContaining({
          source_actor_id: 'slack:T123:U123',
          profile: expect.objectContaining({
            display_name: 'Olivier',
            email: 'founder@runtime.local',
          }),
        }),
      },
    });
    expect(slack_sdk.users_info).toHaveBeenCalledWith({ user: 'U123' });
    expect(slack_sdk.chat_stream).not.toHaveBeenCalled();
    expect(slack_sdk.stream_stop).not.toHaveBeenCalled();
    expect(slack_sdk.chat_post_message).not.toHaveBeenCalled();
    expect(slack_sdk.chat_update).not.toHaveBeenCalled();
  });

  it('clears stale Slack conversation bindings when refreshing the default route', async () => {
    const fixture = await create_fixture();

    await fixture.db
      .update(channels)
      .set({
        external_conversation_id: 'C_OLD',
        external_thread_id: '1700000000.000001',
        conversation_scope: 'channel',
      })
      .where(eq(channels.channel_id, fixture.default_channel.channel_id));

    const refreshed = await upsert_default_slack_channel_for_connection(fixture.db, {
      connection: {
        connection_id: 'conn_slack_dispatch',
        workspace_id: fixture.bootstrap.workspace_id,
        provider_key: 'native',
        provider_config_key: 'native:slack',
        connection_profile_key: 'native:slack:oauth_bot',
        external_account_id: 'T123',
        external_account_name: 'Test workspace',
      },
      actor_id: fixture.bootstrap.user_id,
    });

    expect(refreshed).toMatchObject({
      channel_id: fixture.default_channel.channel_id,
      external_conversation_id: null,
      external_thread_id: null,
      conversation_scope: 'any',
    });
  });

  it('matches a configured private channel route for top-level Slack mentions', async () => {
    const fixture = await create_fixture();
    slack_sdk.chat_post_message.mockResolvedValue({
      ok: true,
      channel: 'G_PRIVATE',
      ts: '1710000000.000100',
    });
    slack_sdk.chat_update.mockResolvedValue({ ok: true });

    await fixture.db
      .update(channels)
      .set({
        external_conversation_id: 'G_PRIVATE',
        conversation_scope: 'group',
      })
      .where(eq(channels.channel_id, fixture.default_channel.channel_id));

    const result = await dispatch_slack_channel_event(
      fixture.db,
      {
        channel_provider_key: 'slack',
        provider_event_id: 'EvPrivate',
        received_time: new Date('2026-06-01T10:00:00.000Z'),
        external_account_id: 'T123',
        provider_event_type: 'app_mention',
        raw_event: {
          type: 'event_callback',
          team_id: 'T123',
          event_id: 'EvPrivate',
          event: {
            type: 'app_mention',
            channel: 'G_PRIVATE',
            channel_type: 'group',
            user: 'U123',
            ts: '1700000000.000010',
            text: '<@B123> private status?',
          },
        },
      },
      { run_options: { workspace_runtime_provider: 'local' } },
    );

    expect(result).toMatchObject({
      dispatched: true,
      channel_id: fixture.default_channel.channel_id,
    });
  });

  it('dispatches messages that carry an uploaded file (subtype file_share)', async () => {
    const fixture = await create_fixture();
    slack_sdk.chat_post_message.mockResolvedValue({
      ok: true,
      channel: 'C123',
      ts: '1710000000.000200',
    });
    slack_sdk.chat_update.mockResolvedValue({ ok: true });

    const result = await dispatch_slack_channel_event(
      fixture.db,
      {
        channel_provider_key: 'slack',
        provider_event_id: 'EvFileShare',
        received_time: new Date('2026-06-01T10:05:00.000Z'),
        external_account_id: 'T123',
        provider_event_type: 'app_mention',
        raw_event: {
          type: 'event_callback',
          team_id: 'T123',
          event_id: 'EvFileShare',
          event: {
            type: 'app_mention',
            subtype: 'file_share',
            channel: 'C123',
            channel_type: 'channel',
            user: 'U123',
            ts: '1700000000.000020',
            text: '<@B123> here is the screenshot',
            files: [{ id: 'F123', name: 'image.png', mimetype: 'image/png' }],
          },
        },
      },
      { run_options: { workspace_runtime_provider: 'local' } },
    );

    expect(result).toMatchObject({ dispatched: true });
  });

  it('leaves queued Slack work to its active owner without starting a polling chain', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T10:00:00.000Z'));
    const fixture = await create_fixture();
    const queue_key = 'slack:T123:C123:thread:1700000000.000011';
    await enqueue_slack_event(fixture, {
      source_event_id: 'EvRunning',
      queue_key,
      text: 'first',
      raw_text: '<@B123> first',
      event_ts: '1700000000.000011',
    });

    const [running_job] = await claim_ready_event_jobs_for_queue(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      queue_key,
      worker_id: 'worker-a',
      now: new Date('2026-06-06T10:00:00.000Z'),
    });
    await enqueue_slack_event(fixture, {
      source_event_id: 'EvWaiting',
      queue_key,
      text: 'second',
      raw_text: 'second',
      event_ts: '1700000000.000020',
      thread_ts: '1700000000.000011',
    });

    const set_timeout = vi.spyOn(globalThis, 'setTimeout');
    const result = await run_queue_jobs(
      fixture.db,
      {
        workspace_id: fixture.bootstrap.workspace_id,
        queue_key,
        worker_id: 'worker-b',
      },
      find_event_job_handler,
    );
    const jobs = await fixture.db.query.event_jobs.findMany({
      where: eq(event_jobs.queue_key, queue_key),
    });

    expect(running_job).toMatchObject({ job_status: 'running', locked_by: 'worker-a' });
    expect(result.ran_jobs).toBe(false);
    expect(jobs.map((job) => job.job_status).sort()).toEqual(['queued', 'running']);
    expect(set_timeout).not.toHaveBeenCalled();
    set_timeout.mockRestore();
  });

  it('marks queued Slack jobs failed when dispatch cannot find a connection', async () => {
    const fixture = await create_fixture();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queue_key = 'slack:T_MISSING:C123:thread:1700000000.000050';
    await enqueue_event_jobs(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      source: 'slack',
      source_event_id: 'EvMissingConnection',
      event_type: 'app_mention',
      queue_key,
      actor_key: 'slack_user:U123',
      event_body: {
        team_id: 'T_MISSING',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000050',
        thread_ts: '1700000000.000050',
        user_id: 'U123',
        text: 'status?',
        raw_text: '<@B123> status?',
        mentioned_bot_user_id: 'B123',
      },
      raw_payload: {
        type: 'event_callback',
        team_id: 'T_MISSING',
        event_id: 'EvMissingConnection',
        event: {
          type: 'app_mention',
          channel: 'C123',
          channel_type: 'channel',
          user: 'U123',
          ts: '1700000000.000050',
          text: '<@B123> status?',
        },
      },
      event_jobs: [
        {
          job_handler: 'slack_agent_message',
          available_time: new Date('2020-01-01T00:00:00.000Z'),
        },
      ],
    });

    const result = await run_queue_jobs(
      fixture.db,
      {
        workspace_id: fixture.bootstrap.workspace_id,
        queue_key,
        worker_id: 'test-worker',
      },
      find_event_job_handler,
    );
    const [job] = await fixture.db.query.event_jobs.findMany({
      where: eq(event_jobs.queue_key, queue_key),
    });

    expect(result.ran_jobs).toBe(true);
    expect(job).toMatchObject({
      job_status: 'failed',
      error_data: {
        code: 'connection_missing',
        message: 'No active Slack connection found for team T_MISSING.',
      },
    });
    const dispatch_line = find_logged_line(error, 'Slack event was not dispatched');
    expect(dispatch_line).toContain('"code":"connection_missing"');
    expect(dispatch_line).toContain(`"workspace_id":"${fixture.bootstrap.workspace_id}"`);
    expect(dispatch_line).toContain(`"queue_key":"${queue_key}"`);

    const handler_line = find_logged_line(error, 'Event job handler failed');
    expect(handler_line).toContain('"job_handler":"slack_agent_message"');
    expect(handler_line).toContain('"code":"connection_missing"');
    expect(handler_line).toContain(`"queue_key":"${queue_key}"`);
  });

  it('completes a policy-denied Slack turn as ignored, not a failed job', async () => {
    const fixture = await create_fixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queue_key = 'slack:T123:C123:channel';
    await enqueue_event_jobs(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      source: 'slack',
      source_event_id: 'EvNoMention',
      event_type: 'message',
      queue_key,
      actor_key: 'slack_user:U123',
      event_body: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000061',
        user_id: 'U123',
        text: 'just chatting in the channel, no mention',
      },
      raw_payload: {
        type: 'event_callback',
        team_id: 'T123',
        event_id: 'EvNoMention',
        event: {
          type: 'message',
          channel: 'C123',
          channel_type: 'channel',
          user: 'U123',
          ts: '1700000000.000061',
          text: 'just chatting in the channel, no mention',
        },
      },
      event_jobs: [
        {
          job_handler: 'slack_agent_message',
          available_time: new Date('2020-01-01T00:00:00.000Z'),
        },
      ],
    });

    const result = await run_queue_jobs(
      fixture.db,
      {
        workspace_id: fixture.bootstrap.workspace_id,
        queue_key,
        worker_id: 'test-worker',
      },
      find_event_job_handler,
    );
    const [job] = await fixture.db.query.event_jobs.findMany({
      where: eq(event_jobs.queue_key, queue_key),
    });

    expect(result.ran_jobs).toBe(true);
    expect(job).toMatchObject({
      job_status: 'done',
      result_data: expect.objectContaining({ dispatched: false, code: 'turn_not_authorized' }),
    });
    expect(error).not.toHaveBeenCalledWith(
      '[event_job_runner] Event job handler failed',
      expect.anything(),
    );
    warn.mockRestore();
    error.mockRestore();
  });

  it('routes an event carrying an api_app_id to the sole active connection for the team', async () => {
    const fixture = await create_fixture();

    const result = await dispatch_slack_channel_event(
      fixture.db,
      {
        channel_provider_key: 'slack',
        provider_event_id: 'EvApp',
        received_time: new Date('2026-06-01T10:00:00.000Z'),
        external_account_id: 'T123',
        provider_event_type: 'app_mention',
        raw_event: {
          type: 'event_callback',
          team_id: 'T123',
          api_app_id: 'A_LOCAL',
          event_id: 'EvApp',
          event: {
            type: 'app_mention',
            channel: 'C123',
            channel_type: 'channel',
            user: 'U123',
            ts: '1700000000.000002',
            text: '<@B123> status?',
          },
        },
      },
      { run_options: { workspace_runtime_provider: 'local' } },
    );

    expect(result).toMatchObject({
      dispatched: true,
      connection_id: 'conn_slack_dispatch',
    });
    expect(slack_sdk.web_client_tokens).toContain('xoxb-dispatch');
  });

  it('runs queued Slack events as one ordered thread turn', async () => {
    const fixture = await create_fixture();
    const queue_key = 'slack:T123:C123:thread:1700000000.000010';
    slack_sdk.users_info.mockResolvedValue({
      ok: true,
      user: {
        id: 'U123',
        name: 'olivier',
        profile: { display_name: 'Olivier', email: 'founder@runtime.local' },
      },
    });

    await enqueue_slack_event(fixture, {
      source_event_id: 'EvReply',
      queue_key,
      text: 'Alfera, continue',
      raw_text: 'Alfera, continue',
      event_ts: '1700000000.000020',
      thread_ts: '1700000000.000010',
    });
    await enqueue_slack_event(fixture, {
      source_event_id: 'EvRoot',
      queue_key,
      text: 'test',
      raw_text: '<@B123> test',
      event_ts: '1700000000.000010',
    });

    const result = await run_queue_jobs(
      fixture.db,
      {
        workspace_id: fixture.bootstrap.workspace_id,
        queue_key,
        worker_id: 'test-worker',
      },
      find_event_job_handler,
    );
    const [done_job] = await fixture.db.query.event_jobs.findMany({
      where: and(
        eq(event_jobs.queue_key, queue_key),
        eq(event_jobs.job_handler, 'slack_agent_message'),
      ),
      orderBy: (table, { asc }) => [asc(table.last_updated_time)],
    });
    const session_id = read_session_id(done_job?.result_data);
    const messages = await list_session_messages(
      fixture.db,
      fixture.bootstrap.workspace_id,
      session_id,
    );

    const user_messages = messages
      .filter((message) => message.message_role === 'user')
      .map((message) => message.content_text);

    expect(result.ran_jobs).toBe(true);
    expect(done_job?.result_data).toMatchObject({
      turn_finalize: {
        outcome: 'delivered_recovered_reply',
        delivery_duration_ms: expect.any(Number),
      },
    });
    expect(user_messages).toEqual(['test', 'Alfera, continue']);
    expect(slack_sdk.stream_stop).not.toHaveBeenCalled();
    expect(slack_sdk.reactions_remove).toHaveBeenCalledWith({
      channel: 'C123',
      timestamp: '1700000000.000010',
      name: 'hourglass_flowing_sand',
    });
    expect(slack_sdk.reactions_remove).toHaveBeenCalledWith({
      channel: 'C123',
      timestamp: '1700000000.000020',
      name: 'hourglass_flowing_sand',
    });
    expect(slack_sdk.chat_stream).not.toHaveBeenCalled();
  });
});

async function create_fixture() {
  process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'slack-dispatch-test-key';
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  slack_sdk.users_info.mockResolvedValue({
    ok: true,
    user: { id: 'U123', profile: { email: 'founder@runtime.local' } },
  });
  await seed_runtime_tool_catalog(db);
  const slack_app = await db.query.apps.findFirst({
    where: (table, { eq }) => eq(table.app_name, 'slack'),
  });
  if (!slack_app) throw new Error('Slack app seed missing');

  await db.insert(connections).values({
    connection_id: 'conn_slack_dispatch',
    workspace_id: bootstrap.workspace_id,
    app_id: slack_app.app_id,
    connection_name: 'Slack dispatch test',
    connection_status: 'active',
    connection_key: 'native:slack:dispatch',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T123',
    external_account_name: 'Test workspace',
    authorized_scopes: ['app_mentions:read', 'channels:read', 'chat:write', 'users:read'],
    health_status: 'healthy',
    credentials: encrypt_connection_credentials({
      credential_source: 'oauth2',
      values: { access_token: 'xoxb-dispatch' },
    }),
    provider_account: { team_id: 'T123', bot_user_id: 'B123' },
    metadata: {},
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
  });
  const default_channel = await upsert_default_slack_channel_for_connection(db, {
    connection: {
      connection_id: 'conn_slack_dispatch',
      workspace_id: bootstrap.workspace_id,
      provider_key: 'native',
      provider_config_key: 'native:slack',
      connection_profile_key: 'native:slack:oauth_bot',
      external_account_id: 'T123',
      external_account_name: 'Test workspace',
    },
    actor_id: bootstrap.user_id,
  });
  if (!default_channel) throw new Error('Default Slack channel route missing');

  return { db, bootstrap, default_channel };
}

async function enqueue_slack_event(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  input: {
    source_event_id: string;
    queue_key: string;
    text: string;
    raw_text: string;
    event_ts: string;
    thread_ts?: string;
  },
) {
  return enqueue_event_jobs(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    source: 'slack',
    source_event_id: input.source_event_id,
    event_type: input.thread_ts ? 'message' : 'app_mention',
    queue_key: input.queue_key,
    actor_key: 'slack_user:U123',
    event_body: build_slack_event_body(input),
    raw_payload: build_slack_raw_event(input),
    event_jobs: [
      {
        job_handler: 'slack_agent_message',
        available_time: new Date('2020-01-01T00:00:00.000Z'),
      },
    ],
  });
}

function build_slack_event_body(input: {
  text: string;
  raw_text: string;
  event_ts: string;
  thread_ts?: string;
}) {
  return {
    team_id: 'T123',
    channel_id: 'C123',
    channel_type: 'channel',
    event_ts: input.event_ts,
    ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
    user_id: 'U123',
    text: input.text,
    raw_text: input.raw_text,
    mentioned_bot_user_id: input.raw_text.includes('<@B123>') ? 'B123' : undefined,
  };
}

function build_slack_raw_event(input: {
  source_event_id: string;
  raw_text: string;
  event_ts: string;
  thread_ts?: string;
}) {
  return {
    type: 'event_callback',
    team_id: 'T123',
    event_id: input.source_event_id,
    event: {
      type: input.thread_ts ? 'message' : 'app_mention',
      channel: 'C123',
      channel_type: 'channel',
      user: 'U123',
      ts: input.event_ts,
      text: input.raw_text,
      ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
    },
  };
}

function read_session_id(result_data: unknown) {
  if (!result_data || typeof result_data !== 'object') throw new Error('Missing result data');
  const session_id = (result_data as Record<string, unknown>).session_id;
  if (typeof session_id !== 'string') {
    throw new Error(`Missing session id in ${JSON.stringify(result_data)}`);
  }
  return session_id;
}
