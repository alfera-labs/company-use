import { events } from '@coworker/core/db/schema';
import { scout_actor, scout_config_key } from '@coworker/shared';
import { create_fixture } from '@runtime-platform/tools/slack/__tests__/native_execution_fixture';
import { afterEach, describe, expect, it, vi } from 'vitest';

const slack_sdk = vi.hoisted(() => ({
  clients: [] as string[],
  conversations_list: vi.fn(),
  conversations_join: vi.fn(),
  conversations_history: vi.fn(),
  conversations_replies: vi.fn(),
  conversations_open: vi.fn(),
  users_list: vi.fn(),
  chat_post_message: vi.fn(),
  files_info: vi.fn(),
  files_upload_v2: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    conversations = {
      list: slack_sdk.conversations_list,
      join: slack_sdk.conversations_join,
      history: slack_sdk.conversations_history,
      replies: slack_sdk.conversations_replies,
      open: slack_sdk.conversations_open,
    };
    users = { list: slack_sdk.users_list };
    chat = { postMessage: slack_sdk.chat_post_message };
    files = { info: slack_sdk.files_info, uploadV2: slack_sdk.files_upload_v2 };

    constructor(token: string) {
      slack_sdk.clients.push(token);
    }
  },
}));

describe('native Slack catalog execution for the scout', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  });

  it('refuses every scout Slack delivery through runtime-execute_tool-1', async () => {
    const source_event_id = 'evt_scout_source';
    const fixture = await create_fixture({
      actor_id: scout_actor,
      source_context: {
        source_type: 'runtime',
        source_metadata: { [scout_config_key]: { observed_event_ids: [source_event_id] } },
      },
    });
    await fixture.db.insert(events).values({
      event_id: source_event_id,
      workspace_id: fixture.bootstrap.workspace_id,
      source: 'slack',
      source_event_id: 'Ev_HEARTBEAT_SOURCE',
      event_type: 'message',
      queue_key: 'slack:T123:C_SOURCE:thread:1700000000.000100',
      actor_key: 'slack:T123:U_REQUESTER',
      event_body: {
        team_id: 'T123',
        channel_id: 'C_SOURCE',
        event_ts: '1700000000.000100',
        user_id: 'U_REQUESTER',
        raw_text: 'Please prepare the report for <@U_OWNER>.',
      },
      created_by: 'test',
      last_updated_by: 'test',
    });

    for (const input of [
      { channel_id: 'C_RANDOM', message: 'Wrong place.', source_event_id },
      {
        channel_id: 'C_SOURCE',
        thread_ts: '1700000000.000100',
        message: 'Its own thread.',
        source_event_id,
      },
      { channel_id: 'U_REQUESTER', message: 'A direct message.', source_event_id },
    ]) {
      const refused = await fixture.execute_tool(
        { node_key: 'slack-send_message-1', input },
        { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
      );
      expect(refused).toMatchObject({ ok: false, error_code: 'scout_cannot_message_people' });
    }
    expect(slack_sdk.conversations_replies).not.toHaveBeenCalled();
    expect(slack_sdk.chat_post_message).not.toHaveBeenCalled();
  });
});
