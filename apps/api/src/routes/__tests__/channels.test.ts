import { createHmac } from 'node:crypto';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { connections } from '@coworker/core/db/schema';
import { prepare_slack_channel_event_jobs } from '@runtime-platform/channels/slack/channel_event_queue';
import { afterEach, describe, expect, it, vi } from 'vitest';

const original_event_job_config = {
  API_URL: env.API_URL,
  COWORKER_API_PROXY_SECRET: env.COWORKER_API_PROXY_SECRET,
  EVENT_JOB_DISPATCH_MODE: env.EVENT_JOB_DISPATCH_MODE,
};

describe('channel event routes', () => {
  afterEach(() => {
    Object.assign(env, original_event_job_config);
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('handles Slack URL verification before workspace middleware', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', '');
    const app = await create_test_app({});

    const response = await app.request('/v1/channels/slack/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'url_verification',
        challenge: 'challenge_123',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ challenge: 'challenge_123' });
  });

  it('keeps the legacy Slack platform event URL out of the machine trigger route', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', '');
    const app = await create_test_app({});

    const response = await app.request('/v1/events/channels/slack-platform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'url_verification',
        challenge: 'legacy_challenge_123',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ challenge: 'legacy_challenge_123' });
  });

  it('accepts a Slack event callback through the generic channel interface', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', '');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = await create_test_app({});

    const response = await app.request('/v1/channels/slack/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event_callback',
        event_id: 'Ev123',
        team_id: 'T123',
        event: { type: 'app_mention', channel: 'C123', user: 'U123' },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      accepted: true,
      channel_provider_key: 'slack',
      provider_event_id: 'Ev123',
      external_account_id: 'T123',
      provider_event_type: 'app_mention',
    });
  });

  it('logs Slack callbacks that are accepted but cannot be queued', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', '');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = await create_test_app(db);

    const response = await app.request('/v1/channels/slack/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event_callback',
        event_id: 'EvNoConnection',
        team_id: 'T_NO_CONNECTION',
        api_app_id: 'A_UNKNOWN',
        event: {
          type: 'app_mention',
          channel: 'C123',
          channel_type: 'channel',
          user: 'U123',
          ts: '1717600000.000150',
          text: '<@B123> ping',
        },
      }),
    });
    const body = await response.json();
    const events = await db.query.events.findMany();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      accepted: true,
      provider_event_id: 'EvNoConnection',
      external_account_id: 'T_NO_CONNECTION',
      provider_event_type: 'app_mention',
    });
    expect(body.data.workspace_id).toBeUndefined();
    expect(events).toEqual([]);
    const error_lines = error.mock.calls.map(([line]) => line);
    const queue_error_line = error_lines.find((line) =>
      line.startsWith('[slack_channel_event_queue] Slack event was not queued'),
    );
    expect(queue_error_line).toContain('"reason":"active_connection_missing"');
    expect(queue_error_line).toContain('"provider_event_id":"EvNoConnection"');
    expect(queue_error_line).toContain('"team_id":"T_NO_CONNECTION"');
    expect(queue_error_line).toContain('"api_app_id":"A_UNKNOWN"');
    expect(queue_error_line).toContain('"slack_event_type":"app_mention"');
    expect(queue_error_line).toContain('"channel_id":"C123"');
    expect(queue_error_line).toContain('"user_id":"U123"');

    const ingress_error_line = error_lines.find((line) =>
      line.startsWith('[channel_ingress] Channel event accepted without a prepared queue event'),
    );
    expect(ingress_error_line).toContain('"channel_provider_key":"slack"');
    expect(ingress_error_line).toContain('"provider_event_id":"EvNoConnection"');
    expect(ingress_error_line).toContain('"external_account_id":"T_NO_CONNECTION"');
    expect(ingress_error_line).toContain('"provider_event_type":"app_mention"');

    expect(error_lines).toContain(
      '[channel_events] slack event EvNoConnection (account T_NO_CONNECTION) — no run started (workspace_missing)',
    );
  });

  it('persists Slack callbacks and self-dispatches their jobs through the same API service', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T10:00:00.000Z'));
    vi.stubEnv('SLACK_SIGNING_SECRET', '');
    Object.assign(env, {
      API_URL: 'http://api.test',
      COWORKER_API_PROXY_SECRET: 'configured-proxy-secret',
      EVENT_JOB_DISPATCH_MODE: 'http',
    });
    const self_dispatch = vi.fn(
      async (_url: unknown, _request?: RequestInit) => new Response('ok'),
    );
    vi.stubGlobal('fetch', self_dispatch);
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_connection(db, bootstrap);
    const app = await create_test_app(db);

    const response = await app.request('/v1/channels/slack/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event_callback',
        event_id: 'EvQueued',
        team_id: 'T123',
        api_app_id: 'A_LOCAL',
        event: {
          type: 'app_mention',
          channel: 'C123',
          channel_type: 'channel',
          user: 'U123',
          ts: '1717600000.000100',
          text: '<@B123> what is the context?',
        },
      }),
    });
    const body = await response.json();
    const [event] = await db.query.events.findMany({
      where: (table, { eq }) =>
        eq(
          table.source_event_id,
          slack_message_source_event_id('T123', 'C123', '1717600000.000100'),
        ),
    });
    const jobs = await db.query.event_jobs.findMany({
      where: (table, { eq }) => eq(table.event_id, event?.event_id ?? ''),
    });

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      accepted: true,
      provider_event_id: 'EvQueued',
      workspace_id: bootstrap.workspace_id,
      queue_key: 'slack:T123:C123:thread:1717600000.000100',
      queued_job_count: 1,
    });
    expect(event).toMatchObject({
      source: 'slack',
      event_status: 'routed',
      actor_key: 'slack_user:U123',
      event_body: expect.objectContaining({
        text: 'what is the context?',
        raw_text: '<@B123> what is the context?',
      }),
    });
    expect((event?.event_body as Record<string, unknown>).thread_ts).toBeUndefined();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      job_handler: 'slack_agent_message',
      job_status: 'queued',
      queue_key: 'slack:T123:C123:thread:1717600000.000100',
    });
    expect(self_dispatch).toHaveBeenCalledTimes(1);
    expect(self_dispatch).toHaveBeenCalledWith(
      'http://api.test/internal/run-queued-jobs',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"queue_key":"slack:T123:C123:thread:1717600000.000100"'),
      }),
    );
    const dispatch_headers = new Headers(self_dispatch.mock.calls[0]?.[1]?.headers);
    expect(dispatch_headers.get('x-coworker-api-secret')).toBe('configured-proxy-secret');
    expect(dispatch_headers.get('authorization')).toBeNull();
  });

  it('adds an hourglass reaction when queuing a Slack message event', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T10:00:00.000Z'));
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_connection(db, bootstrap, { bot_token: 'xoxb-reaction' });
    const add_reaction = vi.fn().mockResolvedValue(undefined);

    const prepared_event = await prepare_slack_channel_event_jobs(
      db,
      {
        channel_provider_key: 'slack',
        provider_event_id: 'EvReaction',
        received_time: new Date(),
        external_account_id: 'T123',
        provider_event_type: 'app_mention',
        raw_event: slack_event_callback({
          event_id: 'EvReaction',
          event_type: 'app_mention',
          ts: '1717600000.000300',
          text: '<@B123> react',
        }),
      },
      { add_reaction },
    );

    expect(prepared_event).toMatchObject({
      source: 'slack',
      queue_key: 'slack:T123:C123:thread:1717600000.000300',
    });
    expect(add_reaction).toHaveBeenCalledWith({
      token: 'xoxb-reaction',
      channel_id: 'C123',
      timestamp: '1717600000.000300',
      name: 'hourglass_flowing_sand',
    });
  });

  it('starts a mention at once and gives an unmentioned thread reply the 2s window', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-06-06T10:00:00.000Z');
    vi.setSystemTime(now);
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_connection(db, bootstrap, { bot_token: 'xoxb-window' });
    const queue = (event_id: string, event: Parameters<typeof slack_event_callback>[0]) =>
      prepare_slack_channel_event_jobs(
        db,
        {
          channel_provider_key: 'slack',
          provider_event_id: event_id,
          received_time: now,
          external_account_id: 'T123',
          provider_event_type: event.event_type,
          raw_event: slack_event_callback(event),
        },
        { add_reaction: vi.fn().mockResolvedValue(undefined) },
      );

    const mention = await queue('EvMentionNow', {
      event_id: 'EvMentionNow',
      event_type: 'app_mention',
      ts: '1717600000.000400',
      text: '<@B123> yo',
    });
    const reply = await queue('EvReplyWindow', {
      event_id: 'EvReplyWindow',
      event_type: 'message',
      ts: '1717600000.000500',
      thread_ts: '1717600000.000400',
      text: 'thanks both',
    });

    expect(mention?.event_jobs?.[0]?.available_time).toEqual(now);
    expect(reply?.event_jobs?.[0]?.available_time).toEqual(new Date(now.getTime() + 2_000));
  });

  it('does not queue or react to top-level channel messages that do not mention the bot', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_connection(db, bootstrap, { bot_token: 'xoxb-reaction' });
    const add_reaction = vi.fn().mockResolvedValue(undefined);

    const prepared_event = await prepare_slack_channel_event_jobs(
      db,
      {
        channel_provider_key: 'slack',
        provider_event_id: 'EvUnaddressed',
        received_time: new Date(),
        external_account_id: 'T123',
        provider_event_type: 'message',
        raw_event: slack_event_callback({
          event_id: 'EvUnaddressed',
          event_type: 'message',
          ts: '1717600000.000301',
          text: 'random channel note',
        }),
      },
      { add_reaction },
    );

    expect(prepared_event).toMatchObject({
      source: 'slack',
      event_status: 'ignored',
      event_body: expect.objectContaining({
        ignored_reason: 'top_level_mention_required',
      }),
      event_jobs: [],
    });
    expect(add_reaction).not.toHaveBeenCalled();
  });

  it('deduplicates Slack message and app_mention callbacks for one Slack message', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T10:00:00.000Z'));
    vi.stubEnv('SLACK_SIGNING_SECRET', '');
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_connection(db, bootstrap, { bot_token: 'xoxb-dedupe' });
    const app = await create_test_app(db);
    const source_event_id = slack_message_source_event_id('T123', 'C123', '1717600000.000200');

    const first_response = await post_slack_event(app, {
      event_id: 'EvMention',
      event_type: 'app_mention',
      ts: '1717600000.000200',
      text: '<@B123> test',
    });
    const second_response = await post_slack_event(app, {
      event_id: 'EvMessage',
      event_type: 'message',
      ts: '1717600000.000200',
      text: '<@B123> test',
    });
    const retry_response = await post_slack_event(app, {
      event_id: 'EvMentionRetry',
      event_type: 'app_mention',
      ts: '1717600000.000200',
      text: '<@B123> test',
    });
    const first_body = await first_response.json();
    const second_body = await second_response.json();
    const retry_body = await retry_response.json();
    const events = await db.query.events.findMany({
      where: (table, { eq }) => eq(table.source_event_id, source_event_id),
    });

    expect(first_body.data.queued_job_count).toBe(1);
    expect(second_body.data.queued_job_count).toBe(0);
    expect(retry_body.data.queued_job_count).toBe(0);
    expect(events).toHaveLength(1);
  });

  it('rejects unknown channel keys before workspace middleware', async () => {
    const app = await create_test_app({});

    const response = await app.request('/v1/channels/unknown/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toMatchObject({
      code: 'unknown_channel',
      message: 'Unknown channel: unknown',
    });
  });

  it('verifies Slack signatures when a signing secret is configured', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', 'secret_123');
    const app = await create_test_app({});
    const body = JSON.stringify({
      type: 'event_callback',
      event_id: 'EvSigned',
      team_id: 'T123',
      event: { type: 'message' },
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const response = await app.request('/v1/channels/slack/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': build_slack_signature('secret_123', timestamp, body),
      },
      body,
    });

    expect(response.status).toBe(200);
  });

  it('acknowledges signed Slack interactivity callbacks', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', 'secret_123');
    const app = await create_test_app({});
    const body = new URLSearchParams({ payload: '{"type":"block_actions"}' }).toString();
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const response = await app.request('/v1/channels/slack/interactivity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': build_slack_signature('secret_123', timestamp, body),
      },
      body,
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
  });

  it('answers Slack interactivity probe requests before workspace middleware', async () => {
    const app = await create_test_app({});

    const response = await app.request('/v1/channels/slack/interactivity');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('rejects invalid Slack signatures when a signing secret is configured', async () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', 'secret_123');
    const app = await create_test_app({});

    const response = await app.request('/v1/channels/slack/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
        'x-slack-signature': 'v0=invalid',
      },
      body: JSON.stringify({
        type: 'event_callback',
        event_id: 'EvBadSignature',
        event: { type: 'message' },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toMatchObject({
      code: 'slack_signature_invalid',
    });
  });
});

async function create_test_app(db: unknown) {
  const { create_app } = await import('@api/app');
  return create_app(db as never);
}

function post_slack_event(
  app: Awaited<ReturnType<typeof create_test_app>>,
  event: Parameters<typeof slack_event_callback>[0],
) {
  return app.request('/v1/channels/slack/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(slack_event_callback(event)),
  });
}

function build_slack_signature(signing_secret: string, timestamp: string, body_text: string) {
  return `v0=${createHmac('sha256', signing_secret)
    .update(`v0:${timestamp}:${body_text}`)
    .digest('hex')}`;
}

function slack_event_callback(input: {
  event_id: string;
  event_type: 'app_mention' | 'message';
  ts: string;
  thread_ts?: string;
  text: string;
}) {
  return {
    type: 'event_callback',
    event_id: input.event_id,
    team_id: 'T123',
    api_app_id: 'A_LOCAL',
    event: {
      type: input.event_type,
      channel: 'C123',
      channel_type: 'channel',
      user: 'U123',
      ts: input.ts,
      ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
      text: input.text,
    },
  };
}

function slack_message_source_event_id(team_id: string, channel_id: string, ts: string) {
  return `message:${team_id}:${channel_id}:${ts}:${ts}`;
}

async function insert_slack_connection(
  db: Awaited<ReturnType<typeof create_test_database>>,
  bootstrap: Awaited<ReturnType<typeof bootstrap_default_workspace>>,
  options: { bot_token?: string } = {},
) {
  await db.insert(connections).values({
    connection_id: 'conn_api_slack_queue',
    workspace_id: bootstrap.workspace_id,
    app_id: 'app_slack_test',
    connection_name: 'Slack queue test',
    connection_status: 'active',
    connection_key: 'native:slack:api-queue-test',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T123',
    external_account_name: 'Test workspace',
    authorized_scopes: ['app_mentions:read', 'chat:write'],
    health_status: 'healthy',
    ...(options.bot_token ? { credentials: { bot_token: options.bot_token } } : {}),
    provider_account: { team_id: 'T123', app_id: 'A_LOCAL', bot_user_id: 'B123' },
    metadata: {},
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
  });
}
