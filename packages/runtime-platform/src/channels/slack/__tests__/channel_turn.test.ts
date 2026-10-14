import type {
  RuntimeAgentEngine,
  RuntimeAgentEngineEvent,
  RuntimeAgentEngineInput,
} from '@agent-core/runs';
import { build_participants } from '@coworker/core/access/build_participants';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { resolve_catalog_tool } from '@coworker/core/db/queries/catalog';
import { create_channel } from '@coworker/core/db/queries/channels';
import { find_personal_project } from '@coworker/core/db/queries/personal_projects';
import { create_project } from '@coworker/core/db/queries/projects';
import { replace_resource_sharing } from '@coworker/core/db/queries/resource_grants';
import {
  get_run,
  get_session,
  list_run_messages,
  list_session_messages,
} from '@coworker/core/db/queries/sessions';
import { connections, sessions, users, workspace_members } from '@coworker/core/db/schema';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { start_slack_channel_turn } from '@runtime-platform/channels/slack/channel_turn';
import { finalize_slack_channel_turn } from '@runtime-platform/channels/slack/turn_finalize';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const default_engine_events: RuntimeAgentEngineEvent[] = [
  {
    type: 'message_delta',
    delta: 'Slack ',
    accumulated_text: 'Slack ',
  },
  {
    type: 'message_delta',
    delta: 'reply ready.',
    accumulated_text: 'Slack reply ready.',
  },
  {
    type: 'message',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Slack reply ready.' }],
    },
  },
];

const agent_core = vi.hoisted(() => ({
  engine_inputs: [] as RuntimeAgentEngineInput[],
  engine_error: null as Error | null,
  engine_events: null as RuntimeAgentEngineEvent[] | null,
  interim_message: null as string | null,
  respond_message: null as string | null,
}));

const thread_audience = vi.hoisted(() => ({
  result: 'agent' as 'agent' | 'other',
  classify: vi.fn(),
}));

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

vi.mock('@runtime-platform/channels/slack/thread_audience', () => ({
  classify_slack_thread_audience: thread_audience.classify,
}));

vi.mock('@agent-core/engines/pi', async (import_original) => ({
  ...(await import_original<typeof import('@agent-core/engines/pi')>()),
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/slack-channel-test',
    async *run(input) {
      agent_core.engine_inputs.push(input);
      if (agent_core.engine_error) throw agent_core.engine_error;
      if (agent_core.interim_message) {
        const respond = input.tools.find((tool) => tool.tool_name === 'slack-respond-1');
        const result = await respond?.execute?.(
          {
            resolution_type: 'reply',
            message: agent_core.interim_message,
            keep_working: true,
          },
          {
            run_key: 'run-slack-channel-test',
            session_key: 'session-slack-channel-test',
            tool_call_id: 'call-slack-interim-response',
            metadata: {},
          },
        );
        if (!result?.ok) throw new Error(result?.error_message ?? 'Slack interim reply failed');
      }
      if (agent_core.respond_message) {
        const respond = input.tools.find((tool) => tool.tool_name === 'slack-respond-1');
        const result = await respond?.execute?.(
          { resolution_type: 'reply', message: agent_core.respond_message },
          {
            run_key: 'run-slack-channel-test',
            session_key: 'session-slack-channel-test',
            tool_call_id: 'call-slack-respond',
            metadata: {},
          },
        );
        if (!result?.ok) throw new Error(result?.error_message ?? 'slack-respond-1 failed');
      }
      yield* agent_core.engine_events ?? default_engine_events;
    },
  }),
}));

vi.mock('@runtime-platform/model_resolver', () => ({
  resolve_model: () => ({
    model_provider: 'openai',
    model_proxy: 'openai_direct',
    model_name: 'gpt-5',
    reasoning_level: 'medium',
  }),
}));

const slack_sdk = vi.hoisted(() => ({
  web_client_tokens: [] as string[],
  chat_post_message: vi.fn(),
  chat_start_stream: vi.fn(),
  chat_stop_stream: vi.fn(),
  chat_delete: vi.fn(),
  conversations_replies: vi.fn(),
  conversations_info: vi.fn(),
  assistant_set_status: vi.fn(),
  reactions_add: vi.fn(),
  api_call: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    conversations = {
      replies: slack_sdk.conversations_replies,
      info: slack_sdk.conversations_info,
    };

    chat = {
      postMessage: slack_sdk.chat_post_message,
      startStream: slack_sdk.chat_start_stream,
      stopStream: slack_sdk.chat_stop_stream,
      delete: slack_sdk.chat_delete,
    };

    assistant = {
      threads: {
        setStatus: slack_sdk.assistant_set_status,
      },
    };

    reactions = { add: slack_sdk.reactions_add };

    apiCall = slack_sdk.api_call;

    constructor(token: string) {
      slack_sdk.web_client_tokens.push(token);
    }
  },
}));

describe('Slack channel turn', () => {
  beforeEach(() => {
    slack_sdk.chat_post_message.mockResolvedValue({
      ok: true,
      channel: 'C123',
      ts: '1710000000.000100',
    });
    slack_sdk.chat_start_stream.mockResolvedValue({
      ok: true,
      channel: 'C123',
      ts: '1710000000.000050',
    });
    slack_sdk.chat_stop_stream.mockResolvedValue({
      ok: true,
      channel: 'C123',
      ts: '1710000000.000050',
    });
    slack_sdk.chat_delete.mockResolvedValue({ ok: true });
    slack_sdk.conversations_replies.mockResolvedValue({ ok: true, messages: [] });
    slack_sdk.conversations_info.mockResolvedValue({
      ok: true,
      channel: { id: 'C123', name: 'support' },
    });
    slack_sdk.assistant_set_status.mockResolvedValue({ ok: true });
    slack_sdk.reactions_add.mockResolvedValue({ ok: true });
    slack_sdk.api_call.mockResolvedValue({ ok: true, ts: '1710000000.000900' });
    thread_audience.result = 'agent';
    thread_audience.classify.mockImplementation(() => thread_audience.result);
  });

  afterEach(() => {
    slack_sdk.web_client_tokens.length = 0;
    slack_sdk.chat_post_message.mockReset();
    slack_sdk.chat_start_stream.mockReset();
    slack_sdk.chat_stop_stream.mockReset();
    slack_sdk.chat_delete.mockReset();
    slack_sdk.conversations_replies.mockReset();
    slack_sdk.conversations_info.mockReset();
    slack_sdk.assistant_set_status.mockReset();
    slack_sdk.reactions_add.mockReset();
    slack_sdk.api_call.mockReset();
    thread_audience.classify.mockReset();
    agent_core.engine_inputs.length = 0;
    agent_core.engine_error = null;
    agent_core.engine_events = null;
    agent_core.interim_message = null;
    agent_core.respond_message = null;
    vi.unstubAllEnvs();
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  });

  it('keeps runtime diagnostics internal when a Slack run fails', async () => {
    const fixture = await create_fixture();
    agent_core.engine_error = new Error(
      'Failed query: insert into "runs" (...) values (...) params: internal values',
    );

    await expect(
      start_slack_channel_turn(fixture.db, {
        workspace_id: fixture.bootstrap.workspace_id,
        agent_id: fixture.bootstrap.agent_id,
        actor_id: fixture.bootstrap.user_id,
        connection_id: 'conn_slack_channel',
        message: {
          team_id: 'T123',
          channel_id: 'C123',
          channel_type: 'channel',
          event_ts: '1700000000.000002',
          user_id: 'U123',
          user_profile: { email: 'founder@runtime.local' },
          mentioned_bot_user_id: 'B123',
          text: 'hello',
        },
        run_options: { workspace_runtime_provider: 'local' },
      }),
    ).rejects.toThrow('Failed query');

    expect(slack_sdk.api_call).toHaveBeenCalledWith('chat.postMessage', {
      channel: 'C123',
      thread_ts: '1700000000.000002',
      text: "I hit a temporary issue and couldn't finish that request. Please try again.",
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it('accepts a Slack thread reply without replacing its processing reaction with a stream', async () => {
    const fixture = await create_fixture();
    agent_core.interim_message = 'On it, give me a minute.';
    agent_core.respond_message = 'Slack reply ready.';
    slack_sdk.chat_post_message.mockResolvedValue({
      ok: true,
      channel: 'C123',
      ts: '1710000000.000100',
    });

    const result = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000001',
        thread_ts: '1699999999.000001',
        user_id: 'U123',
        user_profile: {
          display_name: 'Oli',
          email: 'founder@runtime.local',
          email_is_verified: true,
          avatar_url: 'https://example.test/avatar.png',
          profile_source: 'provider_profile',
          profile_synced_time: '2026-06-01T10:00:00.000Z',
        },
        mentioned_bot_user_id: 'B123',
        text: 'what is the status?',
      },
      starting_message: {
        text: '✅ Google Docs connected — on it.',
        idempotency_key: 'connection_resume:ws_test:conn_docs',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });

    expect(result).toMatchObject({
      accepted: true,
      external_thread_key: 'slack:T123:C123:thread:1699999999.000001',
    });
    if (!result.accepted) throw new Error('Slack turn was not accepted');

    const messages = await list_session_messages(
      fixture.db,
      fixture.bootstrap.workspace_id,
      result.session_id,
    );
    expect(messages[0]).toMatchObject({
      message_role: 'user',
      source_type: 'slack',
      content_text: 'what is the status?',
      source_metadata: {
        slack: expect.objectContaining({
          channel_id: 'C123',
          conversation_scope: 'thread',
          thread_ts: '1699999999.000001',
          user_id: 'U123',
        }),
        source_actor: expect.objectContaining({
          source_actor_id: 'slack:T123:U123',
          actor_kind: 'external_user',
          policy_state: 'allowed_to_chat',
          external_ids: [
            {
              provider_key: 'slack',
              external_account_id: 'T123',
              external_user_id: 'U123',
            },
          ],
          profile: expect.objectContaining({
            display_name: 'Oli',
            email: 'founder@runtime.local',
            email_is_verified: true,
            avatar_url: 'https://example.test/avatar.png',
            profile_source: 'provider_profile',
            profile_synced_time: '2026-06-01T10:00:00.000Z',
          }),
        }),
      },
    });

    const session = await get_session(
      fixture.db,
      fixture.bootstrap.workspace_id,
      result.session_id,
    );
    expect(session?.session_metadata).toMatchObject({
      actors: [
        expect.objectContaining({
          source_actor_id: 'slack:T123:U123',
          actor_kind: 'external_user',
          message_count: 1,
          profile: expect.objectContaining({
            display_name: 'Oli',
            avatar_url: 'https://example.test/avatar.png',
          }),
        }),
      ],
    });

    const run_messages = await list_run_messages(
      fixture.db,
      fixture.bootstrap.workspace_id,
      result.run_id,
    );
    const final_assistant_message = run_messages
      .filter((message) => message.message_role === 'assistant')
      .at(-1);
    expect(final_assistant_message).toMatchObject({ content_text: 'Slack reply ready.' });
    expect(agent_core.engine_inputs[0]?.system_prompt).toContain('## Progress Protocol');
    expect(agent_core.engine_inputs[0]?.system_prompt).toContain('Lead with the answer');
    expect(agent_core.engine_inputs[0]?.system_prompt).toContain('## Slack Reply Protocol');
    expect(agent_core.engine_inputs[0]?.system_prompt).toContain(
      'The ONLY way they hear you is the slack-respond-1 tool',
    );
    expect(agent_core.engine_inputs[0]?.system_prompt).not.toContain('## Current Turn Context');
    expect(agent_core.engine_inputs[0]?.system_prompt).not.toContain('## Current Connections');
    expect(agent_core.engine_inputs[0]?.system_prompt).not.toContain('"app_name":"slack"');
    expect(agent_core.engine_inputs[0]?.system_prompt).not.toContain('xoxb-channel');
    const engine_message_text = JSON.stringify(agent_core.engine_inputs[0]?.messages ?? []);
    expect(engine_message_text).toContain('## Current Connections');
    expect(engine_message_text).toContain('\\"app_name\\":\\"slack\\"');
    expect(engine_message_text).toContain('\\"external_account_name\\":\\"Test workspace\\"');
    expect(engine_message_text).toContain('## Current Turn Context');
    expect(engine_message_text).toContain('a person just sent you a message in a Slack thread');
    expect(engine_message_text).toContain('channel_id: C123');
    expect(engine_message_text).toContain('thread_ts: 1699999999.000001');
    expect(engine_message_text).toContain('addressing_mode: explicit_mention');
    expect(engine_message_text).toContain('not a user instruction');
    expect(engine_message_text).not.toContain('xoxb-channel');
    expect(slack_sdk.chat_start_stream).not.toHaveBeenCalled();
    expect(slack_sdk.chat_stop_stream).not.toHaveBeenCalled();
    expect(slack_sdk.assistant_set_status).toHaveBeenNthCalledWith(1, {
      channel_id: 'C123',
      thread_ts: '1699999999.000001',
      status: 'Thinking...',
      loading_messages: ['Understanding...', 'Evaluating...', 'Organising...', 'Working...'],
    });
    expect(slack_sdk.assistant_set_status).toHaveBeenLastCalledWith({
      channel_id: 'C123',
      thread_ts: '1699999999.000001',
      status: '',
    });
    expect(slack_sdk.chat_post_message).toHaveBeenCalledTimes(3);
    expect(slack_sdk.chat_post_message).toHaveBeenCalledWith({
      channel: 'C123',
      thread_ts: '1699999999.000001',
      text: '✅ Google Docs connected — on it.',
      metadata: {
        event_type: 'alfera_idempotent_message',
        event_payload: { idempotency_key: 'connection_resume:ws_test:conn_docs' },
      },
      unfurl_links: false,
      unfurl_media: false,
    });
    if (!result.accepted) throw new Error('Slack turn was not accepted');
    const run = await get_run(fixture.db, fixture.bootstrap.workspace_id, result.run_id);
    expect(run?.run_metadata).not.toHaveProperty('turn_stream');
    expect(slack_sdk.api_call).not.toHaveBeenCalled();
  });

  it('recovers an undelivered final answer into the Slack thread', async () => {
    const fixture = await create_fixture();
    slack_sdk.chat_stop_stream.mockResolvedValue({ ok: true, channel: 'C123' });

    const result = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000009',
        user_id: 'U123',
        user_profile: { email: 'founder@runtime.local' },
        mentioned_bot_user_id: 'B123',
        text: 'finish without a stop timestamp',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });
    if (!result.accepted) throw new Error('Slack turn was not accepted');
    const run = await get_run(fixture.db, fixture.bootstrap.workspace_id, result.run_id);
    if (!run) throw new Error('Slack run was not persisted');

    const run_messages = await list_run_messages(
      fixture.db,
      fixture.bootstrap.workspace_id,
      result.run_id,
    );
    const final_assistant_message = run_messages
      .filter((message) => message.message_role === 'assistant')
      .at(-1);

    expect(slack_sdk.chat_start_stream).not.toHaveBeenCalled();
    expect(slack_sdk.chat_stop_stream).not.toHaveBeenCalled();
    expect(slack_sdk.chat_post_message).not.toHaveBeenCalled();
    expect(slack_sdk.api_call).toHaveBeenCalledWith('chat.postMessage', {
      channel: 'C123',
      thread_ts: '1700000000.000009',
      text: 'Slack reply ready.',
      unfurl_links: false,
      unfurl_media: false,
    });
    expect(final_assistant_message).toMatchObject({ content_text: 'Slack reply ready.' });
    expect(result.turn_finalize).toMatchObject({
      outcome: 'delivered_recovered_reply',
      delivery_duration_ms: expect.any(Number),
    });
    expect(run.run_metadata).toMatchObject({
      turn_finalize: {
        outcome: 'delivered_recovered_reply',
        delivery_duration_ms: expect.any(Number),
      },
    });
  });

  it('shows the native assistant status for top-level channel messages', async () => {
    const fixture = await create_fixture();

    const result = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000010',
        user_id: 'U123',
        user_profile: { email: 'founder@runtime.local' },
        mentioned_bot_user_id: 'B123',
        text: 'continue in channel',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });

    expect(result).toMatchObject({
      accepted: true,
      external_thread_key: 'slack:T123:C123:thread:1700000000.000010',
    });
    expect(slack_sdk.chat_start_stream).not.toHaveBeenCalled();
    expect(slack_sdk.assistant_set_status).toHaveBeenNthCalledWith(1, {
      channel_id: 'C123',
      thread_ts: '1700000000.000010',
      status: 'Thinking...',
      loading_messages: ['Understanding...', 'Evaluating...', 'Organising...', 'Working...'],
    });
    expect(slack_sdk.assistant_set_status).toHaveBeenLastCalledWith({
      channel_id: 'C123',
      thread_ts: '1700000000.000010',
      status: '',
    });
  });

  // A channel whose route works in a project starts new chats there, so the run reads that
  // project's instructions and tools. A chat that already exists never moves.
  it("starts a new chat in the channel's project and keeps an existing thread where it is", async () => {
    const fixture = await create_fixture();
    const sales = await create_project(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      project_name: 'Sales',
      actor_id: fixture.bootstrap.user_id,
      owner_id: fixture.bootstrap.user_id,
    });
    const other = await create_project(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      project_name: 'Other',
      actor_id: fixture.bootstrap.user_id,
      owner_id: fixture.bootstrap.user_id,
    });
    const turn = (event_ts: string, thread_ts: string | undefined, channel_project_id: string) =>
      start_slack_channel_turn(fixture.db, {
        workspace_id: fixture.bootstrap.workspace_id,
        agent_id: fixture.bootstrap.agent_id,
        actor_id: fixture.bootstrap.user_id,
        connection_id: 'conn_slack_channel',
        channel_project_id,
        message: {
          team_id: 'T123',
          channel_id: 'C123',
          channel_type: 'channel',
          event_ts,
          ...(thread_ts ? { thread_ts } : {}),
          user_id: 'U123',
          user_profile: { email: 'founder@runtime.local' },
          mentioned_bot_user_id: 'B123',
          text: 'summarise the leads',
        },
        run_options: { workspace_runtime_provider: 'local' },
      });

    const root = await turn('1700000000.000020', undefined, sales.project_id);
    if (!root.accepted) throw new Error('root turn not accepted');
    const reply = await turn('1700000000.000021', '1700000000.000020', other.project_id);
    if (!reply.accepted) throw new Error('reply turn not accepted');

    const session = await get_session(fixture.db, fixture.bootstrap.workspace_id, root.session_id);
    expect(session?.project_id).toBe(sales.project_id);
    expect(reply.session_id).toBe(root.session_id);
    const after_reply = await get_session(
      fixture.db,
      fixture.bootstrap.workspace_id,
      root.session_id,
    );
    expect(after_reply?.project_id).toBe(sales.project_id);
  });

  it('completes the run without exposing intermediate Slack stream state', async () => {
    const fixture = await create_fixture();
    const delivery_warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000015',
        user_id: 'U123',
        user_profile: { email: 'founder@runtime.local' },
        mentioned_bot_user_id: 'B123',
        text: 'make a sheet',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });

    expect(result).toMatchObject({
      accepted: true,
      external_thread_key: 'slack:T123:C123:thread:1700000000.000015',
    });
    if (!result.accepted) throw new Error('Slack turn was not accepted');

    const run = await get_run(fixture.db, fixture.bootstrap.workspace_id, result.run_id);
    const session = await get_session(
      fixture.db,
      fixture.bootstrap.workspace_id,
      result.session_id,
    );
    const run_messages = await list_run_messages(
      fixture.db,
      fixture.bootstrap.workspace_id,
      result.run_id,
    );

    expect(run?.run_status).toBe('completed');
    expect(run?.error_message).toBeNull();
    expect(session?.session_status).toBe('completed');
    const final_assistant_message = run_messages
      .filter((message) => message.message_role === 'assistant')
      .at(-1);
    expect(final_assistant_message).toMatchObject({ content_text: 'Slack reply ready.' });
    expect(slack_sdk.chat_start_stream).not.toHaveBeenCalled();
    expect(slack_sdk.chat_stop_stream).not.toHaveBeenCalled();
    expect(slack_sdk.chat_post_message).not.toHaveBeenCalled();
    expect(slack_sdk.api_call).toHaveBeenCalledWith('chat.postMessage', {
      channel: 'C123',
      thread_ts: '1700000000.000015',
      text: 'Slack reply ready.',
      unfurl_links: false,
      unfurl_media: false,
    });
    const unexpected_warnings = delivery_warning.mock.calls.filter(
      ([message]) =>
        typeof message !== 'string' || !message.startsWith('[memory] embedding skipped'),
    );
    expect(unexpected_warnings).toEqual([]);
    delivery_warning.mockRestore();
  });

  it('recovers only the final answer, not interim drafts, when a run ends without slack-respond-1', async () => {
    const fixture = await create_fixture();
    agent_core.engine_events = [
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Checking the sheet.' }],
        },
      },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Final answer ready.' }],
        },
      },
    ];
    const result = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000025',
        user_id: 'U123',
        user_profile: { email: 'founder@runtime.local' },
        mentioned_bot_user_id: 'B123',
        text: 'update the sheet',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });

    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) throw new Error('Slack turn was not accepted');

    const run_messages = await list_run_messages(
      fixture.db,
      fixture.bootstrap.workspace_id,
      result.run_id,
    );
    const assistant_messages = run_messages.filter(
      (message) => message.message_role === 'assistant',
    );
    expect(assistant_messages).toHaveLength(2);
    const interim_message = assistant_messages[0];
    const final_message = assistant_messages[1];

    expect(interim_message).toMatchObject({
      content_text: 'Checking the sheet.',
    });
    expect(final_message).toMatchObject({ content_text: 'Final answer ready.' });
    expect(slack_sdk.chat_post_message).not.toHaveBeenCalled();
    expect(slack_sdk.chat_stop_stream).not.toHaveBeenCalled();
    expect(slack_sdk.api_call).toHaveBeenCalledOnce();
    const recovered_text = slack_sdk.api_call.mock.calls[0]?.[1]?.text;
    expect(recovered_text).toContain('Final answer ready.');
    expect(recovered_text).not.toContain('Checking the sheet.');
    expect(recovered_text).not.toContain("couldn't post a reply");
  });

  it('does not post twice when a second finalize runs on the same run (single-winner claim)', async () => {
    const fixture = await create_fixture();
    const result = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000055',
        user_id: 'U123',
        user_profile: { email: 'founder@runtime.local' },
        mentioned_bot_user_id: 'B123',
        text: 'summarize the doc',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });
    if (!result.accepted) throw new Error('Slack turn was not accepted');
    expect(slack_sdk.api_call).toHaveBeenCalledTimes(1);

    const { WebClient } = await import('@slack/web-api');
    const second = await finalize_slack_channel_turn(fixture.db, {
      slack_api: new WebClient('token') as unknown as Parameters<
        typeof finalize_slack_channel_turn
      >[1]['slack_api'],
      workspace_id: fixture.bootstrap.workspace_id,
      run_id: result.run_id,
      run_status: 'completed',
      channel_id: 'C123',
      thread_ts: '1700000000.000055',
      actor_id: fixture.bootstrap.user_id,
      finalized_by: 'second_caller_test',
    });

    expect(second).toEqual({ finalized: false, outcome: 'already_finalized' });
    expect(slack_sdk.api_call).toHaveBeenCalledTimes(1);
  });

  it('continues a known Slack thread without requiring another bot mention', async () => {
    const fixture = await create_fixture();

    const root = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000030',
        user_id: 'U123',
        user_profile: { email: 'founder@runtime.local' },
        mentioned_bot_user_id: 'B123',
        text: 'send a message in my engineering channel',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });
    if (!root.accepted) throw new Error('Slack root turn was not accepted');

    const follow_up = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000040',
        thread_ts: '1700000000.000030',
        user_id: 'U123',
        user_profile: { email: 'founder@runtime.local' },
        text: 'find out yourself',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });

    expect(follow_up).toMatchObject({
      accepted: true,
      session_id: root.session_id,
      external_thread_key: 'slack:T123:C123:thread:1700000000.000030',
    });
    if (!follow_up.accepted) throw new Error('Slack follow-up turn was not accepted');

    const user_messages = (
      await list_session_messages(fixture.db, fixture.bootstrap.workspace_id, follow_up.session_id)
    ).filter((message) => message.message_role === 'user');
    expect(user_messages.map((message) => message.content_text)).toEqual([
      'send a message in my engineering channel',
      'find out yourself',
    ]);
    expect(thread_audience.classify).toHaveBeenCalledTimes(1);
    const session = await get_session(
      fixture.db,
      fixture.bootstrap.workspace_id,
      follow_up.session_id,
    );
    expect(session?.session_title).toBe('Slack Channel Conversation');
    expect(slack_sdk.conversations_info).toHaveBeenCalledWith({ channel: 'C123' });
    expect(slack_sdk.reactions_add).toHaveBeenCalledWith({
      channel: 'C123',
      timestamp: '1700000000.000040',
      name: 'hourglass_flowing_sand',
    });
  });

  it('sends the same system prompt bytes on every turn of a session', async () => {
    const fixture = await create_fixture();

    const root = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000050',
        user_id: 'U123',
        user_profile: { email: 'founder@runtime.local' },
        mentioned_bot_user_id: 'B123',
        text: 'first question',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });
    if (!root.accepted) throw new Error('Slack root turn was not accepted');

    await fixture.db
      .update(connections)
      .set({ health_status: 'unhealthy' })
      .where(eq(connections.connection_id, 'conn_slack_channel'));

    const follow_up = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000060',
        thread_ts: '1700000000.000050',
        user_id: 'U123',
        user_profile: { email: 'founder@runtime.local' },
        text: 'second question',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });
    if (!follow_up.accepted) throw new Error('Slack follow-up turn was not accepted');

    const [first_input, second_input] = agent_core.engine_inputs;
    expect(agent_core.engine_inputs).toHaveLength(2);
    expect(second_input?.system_prompt).toBe(first_input?.system_prompt);

    const second_turn_messages = JSON.stringify(second_input?.messages ?? []);
    expect(second_turn_messages).toContain('second question');
    expect(second_turn_messages).toContain('thread_ts: 1700000000.000050');
    expect(second_turn_messages).toContain('## Current Connections');
  });

  it('ignores an unmentioned thread message addressed to another human', async () => {
    const fixture = await create_fixture();
    const root = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000080',
        user_id: 'U123',
        user_profile: { email: 'founder@runtime.local' },
        mentioned_bot_user_id: 'B123',
        text: 'research this for me',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });
    if (!root.accepted) throw new Error('Slack root turn was not accepted');

    thread_audience.result = 'other';
    slack_sdk.assistant_set_status.mockClear();
    slack_sdk.reactions_add.mockClear();
    const follow_up = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000090',
        thread_ts: '1700000000.000080',
        user_id: 'U123',
        user_profile: { display_name: 'Robin', email: 'founder@runtime.local' },
        text: 'hey Otto',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });

    expect(follow_up).toEqual({
      accepted: false,
      code: 'message_not_for_agent',
      message: 'Slack thread message is addressed to another participant.',
    });
    expect(thread_audience.classify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ text: 'hey Otto' }),
        stored_messages: expect.any(Array),
      }),
    );
    expect(slack_sdk.reactions_add).not.toHaveBeenCalled();
    expect(slack_sdk.assistant_set_status).toHaveBeenCalledTimes(2);
    expect(slack_sdk.chat_start_stream).not.toHaveBeenCalled();
    expect(agent_core.engine_inputs).toHaveLength(1);
  });

  it('rejects an unmentioned reply in a human-only Slack thread', async () => {
    const fixture = await create_fixture();
    await create_channel(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      channel_provider_key: 'slack',
      channel_name: '#engineering',
      external_account_id: 'T123',
      external_conversation_id: 'C123',
      conversation_scope: 'channel',
      target_kind: 'agent',
      target_id: fixture.bootstrap.agent_id,
      channel_config: {
        channel_policy: {
          require_bot_mention_in_channels: true,
        },
        context_backfill: {
          thread_initial_limit: 20,
        },
      },
    });
    slack_sdk.conversations_replies.mockResolvedValue({
      ok: true,
      messages: [
        {
          type: 'message',
          ts: '1700000000.000050',
          user: 'U123',
          text: 'send a message in my engineering channel',
        },
      ],
    });

    const result = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        event_ts: '1700000000.000070',
        thread_ts: '1700000000.000050',
        user_id: 'U123',
        user_profile: { display_name: 'Oli', email: 'founder@runtime.local' },
        text: 'find out yourself',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });

    expect(result).toEqual({
      accepted: false,
      code: 'mention_required',
      message: 'Slack channel messages must mention the bot.',
    });
    expect(slack_sdk.conversations_replies).toHaveBeenCalledWith({
      channel: 'C123',
      ts: '1700000000.000050',
      limit: 20,
      inclusive: true,
    });
    expect(slack_sdk.conversations_replies).toHaveBeenCalledTimes(1);
    expect(agent_core.engine_inputs).toHaveLength(0);
    expect(slack_sdk.chat_start_stream).not.toHaveBeenCalled();
  });

  it('uses configured channel policy for a Slack conversation', async () => {
    const fixture = await create_fixture();
    const channel = await create_channel(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      channel_provider_key: 'slack',
      channel_name: '#support',
      external_account_id: 'T123',
      external_conversation_id: 'C456',
      conversation_scope: 'channel',
      target_kind: 'agent',
      target_id: fixture.bootstrap.agent_id,
      channel_config: {
        channel_policy: {
          allowed_channel_ids: ['C456'],
          require_bot_mention_in_channels: false,
        },
        context_policy: {
          recent_message_limit: 30,
        },
      },
    });
    const result = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C456',
        channel_type: 'channel',
        event_ts: '1700000000.000020',
        user_id: 'U123',
        user_profile: { email: 'founder@runtime.local' },
        text: 'support update',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });

    expect(result).toMatchObject({
      accepted: true,
      configured_channel_id: channel.channel_id,
      external_thread_key: 'slack:T123:C456:thread:1700000000.000020',
    });
    if (!result.accepted) throw new Error('Slack turn was not accepted');

    const messages = await list_session_messages(
      fixture.db,
      fixture.bootstrap.workspace_id,
      result.session_id,
    );
    expect(messages[0]?.source_metadata).toMatchObject({
      slack: {
        configured_channel_id: channel.channel_id,
        channel_id: 'C456',
      },
    });
    expect(thread_audience.classify).not.toHaveBeenCalled();
    expect(slack_sdk.chat_start_stream).not.toHaveBeenCalled();
    expect(slack_sdk.assistant_set_status).toHaveBeenCalled();
  });

  it('rejects a Slack channel turn before run creation when connection policy denies the channel', async () => {
    const fixture = await create_fixture();

    const result = await start_slack_channel_turn(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      connection_id: 'conn_slack_channel',
      message: {
        team_id: 'T123',
        channel_id: 'C999',
        channel_type: 'channel',
        event_ts: '1700000000.000001',
        user_id: 'U123',
        user_profile: { email: 'founder@runtime.local' },
        mentioned_bot_user_id: 'B123',
        text: 'not allowed',
      },
      run_options: { workspace_runtime_provider: 'local' },
    });

    expect(result).toEqual({
      accepted: false,
      code: 'channel_not_allowed',
      message: 'Slack channel is not allowed for this agent.',
    });
    expect(slack_sdk.chat_post_message).not.toHaveBeenCalled();
    expect(slack_sdk.chat_start_stream).not.toHaveBeenCalled();
  });

  it('links a member who speaks in a DM to their account, so a connection shared only with them works there', async () => {
    const fixture = await create_fixture();
    const member_email = await read_member_email(fixture);
    await share_a_connection_only_with(fixture, fixture.bootstrap.user_id);

    const turn = await start_dm_turn(fixture, { user_profile: { email: member_email } });
    if (!turn.accepted) throw new Error(`DM turn not accepted: ${turn.code}`);

    const session = await get_session(fixture.db, fixture.bootstrap.workspace_id, turn.session_id);
    const own_room = await find_personal_project(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      user_id: fixture.bootstrap.user_id,
    });
    expect(session?.project_id).toBe(own_room?.project_id);
    expect(session?.session_metadata.actors?.[0]).toMatchObject({
      source_actor_id: 'slack:T123:U123',
      platform_user_id: fixture.bootstrap.user_id,
    });

    const verdict = await resolve_catalog_tool(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      node_key: 'slack-read_history-1',
      connection_id: 'conn_only_the_member',
      participants: build_participants({
        project_id: session?.project_id ?? null,
        session_metadata: session?.session_metadata ?? {},
        session_source_metadata: session?.source_metadata ?? null,
        agent_ids: [fixture.bootstrap.agent_id],
      }),
      room_private_to: own_room?.personal_for_user_id ?? null,
    });
    expect(verdict.connection?.connection_id).toBe('conn_only_the_member');
  });

  it('opens no chat for a DM from someone who is not a member, and tells them why', async () => {
    const fixture = await create_fixture();

    const turn = await start_dm_turn(fixture, { user_profile: { email: 'guest@example.com' } });

    expect(turn).toMatchObject({ accepted: false, code: 'slack_speaker_is_not_a_member' });
    expect(await fixture.db.select().from(sessions)).toEqual([]);
    expect(agent_core.engine_inputs).toEqual([]);
    expect(slack_sdk.api_call).toHaveBeenCalledWith('chat.postMessage', refusal_in('D123'));
  });

  it('opens no chat for a DM when Slack gave no email to check', async () => {
    const fixture = await create_fixture();

    const turn = await start_dm_turn(fixture, {});

    expect(turn).toMatchObject({ accepted: false, code: 'slack_speaker_is_unknown' });
    expect(await fixture.db.select().from(sessions)).toEqual([]);
  });

  it('refuses someone who is not a member in a channel too: no chat, no run, and tells them why', async () => {
    const fixture = await create_fixture();

    const turn = await start_channel_turn(fixture, {
      event_ts: '1700000000.000040',
      user_id: 'U999',
      user_profile: { email: 'guest@example.com' },
      mentioned_bot_user_id: 'B123',
    });

    expect(turn).toMatchObject({ accepted: false, code: 'slack_speaker_is_not_a_member' });
    expect(await fixture.db.select().from(sessions)).toEqual([]);
    expect(agent_core.engine_inputs).toEqual([]);
    expect(slack_sdk.api_call).toHaveBeenCalledWith('chat.postMessage', refusal_in('C123'));
  });

  it('stays silent when someone who is not a member replies in a thread without naming the agent', async () => {
    const fixture = await create_fixture();
    const member_turn = await start_channel_turn(fixture, {
      event_ts: '1700000000.000050',
      user_id: 'U123',
      user_profile: { email: await read_member_email(fixture) },
      mentioned_bot_user_id: 'B123',
    });
    if (!member_turn.accepted) throw new Error(`member turn not accepted: ${member_turn.code}`);
    agent_core.engine_inputs.length = 0;
    slack_sdk.api_call.mockClear();

    const guest_turn = await start_channel_turn(fixture, {
      event_ts: '1700000000.000051',
      thread_ts: '1700000000.000050',
      user_id: 'U999',
      user_profile: { email: 'guest@example.com' },
    });

    expect(guest_turn).toMatchObject({ accepted: false, code: 'slack_speaker_is_not_a_member' });
    expect(agent_core.engine_inputs).toEqual([]);
    expect(slack_sdk.api_call).not.toHaveBeenCalledWith('chat.postMessage', refusal_in('C123'));
  });

  it('refuses a person who was a member when they write again in the DM they opened', async () => {
    const fixture = await create_fixture();
    const member_email = await read_member_email(fixture);
    const first_turn = await start_dm_turn(fixture, { user_profile: { email: member_email } });
    if (!first_turn.accepted) throw new Error(`DM turn not accepted: ${first_turn.code}`);
    await fixture.db
      .update(workspace_members)
      .set({ member_status: 'inactive' })
      .where(eq(workspace_members.user_id, fixture.bootstrap.user_id));
    agent_core.engine_inputs.length = 0;

    const later_turn = await start_dm_turn(fixture, { user_profile: { email: member_email } });

    expect(later_turn).toMatchObject({ accepted: false, code: 'slack_speaker_is_not_a_member' });
    expect(agent_core.engine_inputs).toEqual([]);
  });
});

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

async function read_member_email(fixture: Fixture) {
  const [member] = await fixture.db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.user_id, fixture.bootstrap.user_id));
  if (!member) throw new Error('the bootstrapped workspace has no member');
  return member.email;
}

function refusal_in(channel_id: string) {
  return expect.objectContaining({
    channel: channel_id,
    text: expect.stringContaining('members of this Alfera workspace'),
  });
}

function start_channel_turn(
  fixture: Fixture,
  message: {
    event_ts: string;
    thread_ts?: string;
    user_id: string;
    user_profile: { email: string };
    mentioned_bot_user_id?: string;
  },
) {
  return start_slack_channel_turn(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    agent_id: fixture.bootstrap.agent_id,
    actor_id: fixture.bootstrap.user_id,
    connection_id: 'conn_slack_channel',
    message: {
      team_id: 'T123',
      channel_id: 'C123',
      channel_type: 'channel',
      text: 'what is our refund policy?',
      ...message,
    },
    run_options: { workspace_runtime_provider: 'local' },
  });
}

function start_dm_turn(fixture: Fixture, sender: { user_profile?: { email: string } }) {
  return start_slack_channel_turn(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    agent_id: fixture.bootstrap.agent_id,
    actor_id: fixture.bootstrap.user_id,
    connection_id: 'conn_slack_channel',
    channel_policy_override: { allowed_channel_ids: ['D123'] },
    message: {
      team_id: 'T123',
      channel_id: 'D123',
      channel_type: 'im',
      event_ts: '1700000000.000030',
      user_id: 'U123',
      ...sender,
      text: 'update the Lockheed deal',
    },
    run_options: { workspace_runtime_provider: 'local' },
  });
}

async function share_a_connection_only_with(fixture: Fixture, user_id: string) {
  const slack_connection = await fixture.db.query.connections.findFirst({
    where: (table, { eq }) => eq(table.connection_id, 'conn_slack_channel'),
  });
  if (!slack_connection) throw new Error('Slack connection missing');
  await fixture.db.insert(connections).values({
    ...slack_connection,
    connection_id: 'conn_only_the_member',
    connection_key: 'native:slack:only_the_member',
    connection_name: 'Only the member',
    external_account_id: 'T_ONLY_THE_MEMBER',
    connected_by: user_id,
  });
  await replace_resource_sharing(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    resource_type: 'connection',
    resource_id: 'conn_only_the_member',
    shared_with: [{ grantee_type: 'user', grantee_id: user_id, grant_level: 'use' }],
    actor_id: user_id,
  });
}

async function create_fixture() {
  process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'slack-channel-turn-test-key';
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);

  const slack_app = await db.query.apps.findFirst({
    where: (table, { eq }) => eq(table.app_name, 'slack'),
  });
  if (!slack_app) throw new Error('Slack app seed missing');

  await db.insert(connections).values({
    connection_id: 'conn_slack_channel',
    workspace_id: bootstrap.workspace_id,
    app_id: slack_app.app_id,
    connection_name: 'Slack channel test',
    connection_status: 'active',
    connection_key: 'native:slack:channel',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T123',
    external_account_name: 'Test workspace',
    authorized_scopes: ['channels:read', 'chat:write'],
    health_status: 'healthy',
    credentials: encrypt_connection_credentials({
      credential_source: 'oauth2',
      values: { access_token: 'xoxb-channel' },
    }),
    connection_config: {
      slack: {
        channel_policy: {
          allowed_channel_ids: ['C123'],
          require_bot_mention_in_channels: true,
        },
      },
    },
    provider_account: { team_id: 'T123', bot_user_id: 'B123' },
    metadata: {},
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
  });

  return { db, bootstrap };
}
