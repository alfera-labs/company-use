import { list_run_tool_calls } from '@coworker/core/db/queries/sessions';
import { clear_slack_user_directory_cache } from '@runtime-platform/channels/slack/directory';
import { create_fixture } from '@runtime-platform/tools/slack/__tests__/native_execution_fixture';
import { build_stored_zip } from '@runtime-platform/workbooks/__tests__/build_stored_zip';
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

describe('native Slack catalog execution', () => {
  afterEach(() => {
    clear_slack_user_directory_cache();
    slack_sdk.clients.length = 0;
    slack_sdk.conversations_list.mockReset();
    slack_sdk.conversations_join.mockReset();
    slack_sdk.conversations_history.mockReset();
    slack_sdk.conversations_replies.mockReset();
    slack_sdk.conversations_open.mockReset();
    slack_sdk.users_list.mockReset();
    slack_sdk.chat_post_message.mockReset();
    slack_sdk.files_info.mockReset();
    slack_sdk.files_upload_v2.mockReset();
    vi.unstubAllGlobals();
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  });

  it('lists channels through the native Slack provider and persists catalog references', async () => {
    const fixture = await create_fixture();
    slack_sdk.conversations_list.mockResolvedValue({
      ok: true,
      channels: [{ id: 'C123', name: 'general' }],
      response_metadata: { next_cursor: '' },
    });

    const result = await fixture.execute_tool(
      { node_key: 'slack-list_channels-1', input: { limit: 10 } },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(result).toMatchObject({
      ok: true,
      content_json: {
        node_key: 'slack-list_channels-1',
        app_name: 'slack',
        node_name: 'list_channels',
        output: {
          channels: [{ id: 'C123', name: 'general' }],
        },
      },
    });
    expect(slack_sdk.clients).toEqual(['xoxb-test']);
    expect(slack_sdk.conversations_list).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 10,
        types: 'public_channel,private_channel',
        exclude_archived: true,
      }),
    );

    const calls = await list_run_tool_calls(
      fixture.db,
      fixture.bootstrap.workspace_id,
      fixture.run.run_id,
    );
    expect(calls[0]).toMatchObject({
      tool_name: 'runtime-execute_tool-1',
      node_id: fixture.slack_nodes.list_channels.node_id,
      connection_id: 'conn_native_slack',
      tool_status: 'completed',
    });
  });

  it('returns a provider error when Slack returns ok false', async () => {
    const fixture = await create_fixture();
    slack_sdk.conversations_list.mockResolvedValue({
      ok: false,
      error: 'missing_scope',
    });

    const result = await fixture.execute_tool(
      { node_key: 'slack-list_channels-1', input: { limit: 10 } },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(result).toMatchObject({
      ok: false,
      error_code: 'slack_api_error',
      error_message: 'Slack API error: missing_scope',
    });
  });

  it('lists current Slack workspace members from users.list for complete headcounts', async () => {
    const fixture = await create_fixture();
    slack_sdk.users_list.mockResolvedValue({
      ok: true,
      members: [
        {
          id: 'U1',
          real_name: 'Otto Park',
          tz: 'Europe/Rome',
          profile: { email: 'otto@example.com' },
        },
        {
          id: 'U2',
          real_name: 'Robin Tate',
          tz: 'Europe/Rome',
          profile: { email: 'robin@example.com' },
        },
        {
          id: 'U3',
          real_name: 'Deleted User',
          deleted: true,
          profile: { email: 'deleted@example.com' },
        },
        {
          id: 'UBOT',
          real_name: 'Alfera Bot',
          is_bot: true,
          profile: { display_name: 'Alfera' },
        },
      ],
      response_metadata: { next_cursor: '' },
    });

    const result = await fixture.execute_tool(
      { node_key: 'slack-list_workspace_members-1', input: {} },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(result).toMatchObject({
      ok: true,
      content_json: {
        node_key: 'slack-list_workspace_members-1',
        output: {
          human_member_count: 2,
          bot_count: 1,
          counts_are_complete: true,
          directory_truncated: false,
          directory_pages_loaded: 1,
          returned_member_count: 2,
          members: [
            {
              user_id: 'U1',
              real_name: 'Otto Park',
              email: 'otto@example.com',
              is_bot: false,
            },
            {
              user_id: 'U2',
              real_name: 'Robin Tate',
              email: 'robin@example.com',
              is_bot: false,
            },
          ],
        },
      },
    });
    expect(slack_sdk.users_list).toHaveBeenCalledWith({ limit: 200 });
  });

  it('marks member counts as incomplete when the Slack directory reaches the page cap', async () => {
    const fixture = await create_fixture();
    slack_sdk.users_list.mockImplementation(async (input: { cursor?: string }) => {
      const page = input.cursor ? Number(input.cursor.replace('cursor-', '')) : 1;
      return {
        ok: true,
        members: [
          {
            id: `U${page}`,
            real_name: `Member ${page}`,
            profile: { email: `member-${page}@alfera.ai` },
          },
        ],
        response_metadata: { next_cursor: `cursor-${page + 1}` },
      };
    });

    const result = await fixture.execute_tool(
      { node_key: 'slack-list_workspace_members-1', input: { limit: 500 } },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(result).toMatchObject({
      ok: true,
      content_json: {
        node_key: 'slack-list_workspace_members-1',
        output: {
          human_member_count: 25,
          bot_count: 0,
          counts_are_complete: false,
          directory_truncated: true,
          directory_pages_loaded: 25,
          returned_member_count: 25,
        },
      },
    });
    expect(slack_sdk.users_list).toHaveBeenCalledTimes(25);
    expect(slack_sdk.users_list).toHaveBeenNthCalledWith(1, { limit: 200 });
    expect(slack_sdk.users_list).toHaveBeenNthCalledWith(25, {
      limit: 200,
      cursor: 'cursor-25',
    });
  });

  it('reads bounded channel history so the agent can look at the live conversation', async () => {
    const fixture = await create_fixture();
    slack_sdk.conversations_history.mockResolvedValue({
      ok: true,
      messages: [
        {
          ts: '1782914930.514489',
          user: 'U1',
          text: 'checkout is failing',
          files: [{ id: 'F123', name: 'customers.csv', mimetype: 'text/csv', size: 12 }],
        },
        { ts: '1782914885.706579', user: 'U2', text: 'rolling back the deploy' },
      ],
      has_more: false,
    });

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-read_history-1',
        input: { channel_id: 'C123', hours_back: 48, limit: 50 },
      },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(result).toMatchObject({
      ok: true,
      content_json: {
        node_key: 'slack-read_history-1',
        output: {
          channel_id: 'C123',
          thread_ts: null,
          has_more: false,
          messages: [
            {
              message_ts: '1782914930.514489',
              time: '2026-07-01T14:08:50.514Z',
              user_id: 'U1',
              text: 'checkout is failing',
              files: [{ external_file_id: 'F123', file_name: 'customers.csv' }],
            },
            { message_ts: '1782914885.706579', user_id: 'U2', text: 'rolling back the deploy' },
          ],
        },
      },
    });
    expect(slack_sdk.conversations_history).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C123', limit: 50, oldest: expect.any(String) }),
    );
  });

  it('answers a null time for a message whose ts cannot be read', async () => {
    const fixture = await create_fixture();
    slack_sdk.conversations_history.mockResolvedValue({
      ok: true,
      messages: [
        { ts: 'not-a-timestamp', user: 'U1', text: 'checkout is failing' },
        { ts: '0', user: 'U2', text: 'rolling back the deploy' },
      ],
      has_more: false,
    });

    const result = await fixture.execute_tool(
      { node_key: 'slack-read_history-1', input: { channel_id: 'C123' } },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(result).toMatchObject({
      ok: true,
      content_json: {
        output: {
          messages: [
            { message_ts: 'not-a-timestamp', time: null, text: 'checkout is failing' },
            { message_ts: '0', time: null, text: 'rolling back the deploy' },
          ],
        },
      },
    });
  });

  it('downloads a historical Slack file when the HTTP body is smaller than Slack metadata', async () => {
    const file_bytes = new TextEncoder().encode('name\nAcme\n');
    const written_files = new Map<string, Uint8Array>();
    const environment = {
      env_key: 'test',
      env_kind: 'custom' as const,
      stat: async (file_path: string) => {
        const bytes = written_files.get(file_path);
        return bytes ? { kind: 'file' as const, byte_size: bytes.byteLength } : null;
      },
      write_bytes: async (file_path: string, stream: ReadableStream<Uint8Array>) => {
        written_files.set(file_path, new Uint8Array(await new Response(stream).arrayBuffer()));
      },
    };
    const fixture = await create_fixture({ environment });
    slack_sdk.files_info.mockResolvedValue({
      file: {
        id: 'F123',
        name: 'customers.csv',
        mimetype: 'text/csv',
        size: file_bytes.byteLength + 3,
        url_private_download: 'https://files.slack.com/files-pri/T123-F123/customers.csv',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(file_bytes, {
          headers: { 'content-length': String(file_bytes.byteLength) },
        }),
      ),
    );

    const result = await fixture.execute_tool(
      { node_key: 'slack-read_file-1', input: { file_id: 'slack:T123:F123' } },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(result).toMatchObject({
      ok: true,
      content_json: {
        output: {
          path: '/workspace/tmp/attachments/slack_T123_F123/customers.csv',
          byte_size: file_bytes.byteLength,
        },
      },
    });
    expect([...written_files.values()]).toEqual([file_bytes]);
  });

  it('reads one thread when thread_ts is provided', async () => {
    const fixture = await create_fixture();
    slack_sdk.conversations_replies.mockResolvedValue({
      ok: true,
      messages: [{ ts: '1782914930.514489', user: 'U1', text: 'thread parent' }],
      has_more: false,
    });

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-read_history-1',
        input: { channel_id: 'C123', thread_ts: '1782914930.514489' },
      },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(result).toMatchObject({
      ok: true,
      content_json: { output: { thread_ts: '1782914930.514489' } },
    });
    expect(slack_sdk.conversations_replies).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C123', ts: '1782914930.514489' }),
    );
    expect(slack_sdk.conversations_history).not.toHaveBeenCalled();
  });

  it('never bounds a thread read by time, whatever hours_back says', async () => {
    const fixture = await create_fixture();
    slack_sdk.conversations_replies.mockResolvedValue({
      ok: true,
      messages: [{ ts: '1782914930.514489', user: 'U1', text: 'thread parent' }],
      has_more: false,
    });

    await fixture.execute_tool(
      {
        node_key: 'slack-read_history-1',
        input: { channel_id: 'C123', thread_ts: '1782914930.514489', hours_back: 1 },
      },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(slack_sdk.conversations_replies.mock.calls[0]?.[0]).not.toHaveProperty('oldest');
  });

  it('reads the next page when it is handed a cursor, and says where the page ends', async () => {
    const fixture = await create_fixture();
    slack_sdk.conversations_history.mockResolvedValue({
      ok: true,
      messages: [{ ts: '1782914885.706579', user: 'U2', text: 'rolling back the deploy' }],
      has_more: true,
      response_metadata: { next_cursor: 'page-2' },
    });

    const result = await fixture.execute_tool(
      { node_key: 'slack-read_history-1', input: { channel_id: 'C123', cursor: 'page-1' } },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(result).toMatchObject({
      ok: true,
      content_json: { output: { has_more: true, next_cursor: 'page-2' } },
    });
    expect(slack_sdk.conversations_history).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C123', cursor: 'page-1' }),
    );
  });

  it('reads a month of a channel when the caller names no window', async () => {
    const fixture = await create_fixture();
    slack_sdk.conversations_history.mockResolvedValue({ ok: true, messages: [], has_more: false });

    await fixture.execute_tool(
      { node_key: 'slack-read_history-1', input: { channel_id: 'C123' } },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    const oldest = Number.parseFloat(slack_sdk.conversations_history.mock.calls[0]?.[0]?.oldest);
    const days_back = (Date.now() / 1_000 - oldest) / 86_400;
    expect(days_back).toBeGreaterThan(29);
    expect(days_back).toBeLessThan(31);
  });

  it('sends Slack messages directly now that manual approval is disabled', async () => {
    const fixture = await create_fixture();
    slack_sdk.chat_post_message.mockResolvedValue({
      ok: true,
      ts: '1700000000.000100',
      channel: 'C123',
    });

    await fixture.execute_tool(
      {
        node_key: 'slack-send_message-1',
        input: {
          channel_id: 'C123',
          message: 'Read [the doc](https://docs.google.com/document/d/abc) and **confirm**.',
        },
      },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(slack_sdk.chat_post_message).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'Read <https://docs.google.com/document/d/abc|the doc> and *confirm*.',
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it('forwards Block Kit blocks to chat.postMessage while keeping text as the fallback', async () => {
    const fixture = await create_fixture();
    slack_sdk.chat_post_message.mockResolvedValue({
      ok: true,
      ts: '1700000000.000100',
      channel: 'C123',
    });
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: '*Report*' } }];

    await fixture.execute_tool(
      {
        node_key: 'slack-send_message-1',
        input: { channel_id: 'C123', message: 'Report ready.', blocks },
      },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(slack_sdk.chat_post_message).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'Report ready.',
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it('requires an explicit destination for slack-send_message-1', async () => {
    const fixture = await create_fixture({
      source_context: {
        source_type: 'slack',
        source_metadata: {
          slack: {
            connection_id: 'conn_native_slack',
            channel_id: 'C_CURRENT',
            event_ts: '1700000000.000300',
            thread_ts: '1699999999.000100',
            turn_subject_key: 'slack:T123:C_CURRENT:thread:1699999999.000100',
          },
        },
      },
    });
    const result = await fixture.execute_tool(
      { node_key: 'slack-send_message-1', input: { message: 'Complete reply.' } },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(result).toMatchObject({ ok: false });
    expect(slack_sdk.chat_post_message).not.toHaveBeenCalled();
  });

  it('returns the root Slack thread timestamp when sending a thread reply', async () => {
    const fixture = await create_fixture();
    slack_sdk.chat_post_message.mockResolvedValue({
      ok: true,
      ts: '1700000000.000200',
      channel: 'C123',
    });

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-send_message-1',
        input: {
          channel_id: 'C123',
          message: 'thread reply',
          thread_ts: '1700000000.000100',
        },
      },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(slack_sdk.chat_post_message).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'thread reply',
      thread_ts: '1700000000.000100',
      unfurl_links: false,
      unfurl_media: false,
    });
    expect(result).toMatchObject({
      ok: true,
      content_json: {
        output: {
          channel_id: 'C123',
          message_id: '1700000000.000200',
          thread_ts: '1700000000.000100',
        },
      },
    });
  });

  it('keeps explicit direct-message sends unchanged', async () => {
    const fixture = await create_fixture();
    slack_sdk.chat_post_message.mockResolvedValue({
      ok: true,
      ts: '1700000000.000250',
      channel: 'D123',
    });

    await fixture.execute_tool(
      {
        node_key: 'slack-send_message-1',
        input: { channel_id: 'U0EXAMPLE01', message: 'Direct update.' },
      },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(slack_sdk.chat_post_message).toHaveBeenCalledWith({
      channel: 'U0EXAMPLE01',
      text: 'Direct update.',
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it('uploads a workspace file into a Slack thread', async () => {
    const fixture = await create_fixture();
    const file_bytes = new TextEncoder().encode('%PDF-1.4 fake report');
    const read_bytes = vi.fn(async () => file_bytes);
    slack_sdk.files_upload_v2.mockResolvedValue({
      ok: true,
      files: [{ id: 'F123', title: 'Fake report' }],
    });

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-upload_file-1',
        input: {
          channel_id: 'C123',
          file_path: 'artifacts/fake_report.pdf',
          initial_comment: 'Here is the report.',
          thread_ts: '1700000000.000100',
        },
      },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
        environment: {
          env_key: 'native-slack-upload-test',
          env_kind: 'local',
          read_bytes,
        },
      },
    );

    expect(read_bytes).toHaveBeenCalledWith('artifacts/fake_report.pdf');
    expect(slack_sdk.conversations_open).not.toHaveBeenCalled();
    expect(slack_sdk.files_upload_v2).toHaveBeenCalledWith({
      channel_id: 'C123',
      file: expect.any(Buffer),
      filename: 'fake_report.pdf',
      initial_comment: 'Here is the report.',
      thread_ts: '1700000000.000100',
    });
    const upload_input = slack_sdk.files_upload_v2.mock.calls[0]?.[0] as { file?: unknown };
    expect(Buffer.isBuffer(upload_input.file)).toBe(true);
    expect((upload_input.file as Buffer).toString('utf8')).toBe('%PDF-1.4 fake report');
    expect(result).toMatchObject({
      ok: true,
      content_json: {
        node_key: 'slack-upload_file-1',
        app_name: 'slack',
        node_name: 'upload_file',
        output: {
          channel_id: 'C123',
          file_path: 'artifacts/fake_report.pdf',
          filename: 'fake_report.pdf',
          files: [{ id: 'F123', title: 'Fake report' }],
          thread_ts: '1700000000.000100',
        },
      },
    });
  });

  it('uploads a workspace file into the current Slack thread from source context', async () => {
    const fixture = await create_fixture({
      source_context: {
        source_type: 'slack',
        source_metadata: {
          slack: {
            channel_id: 'C999',
            thread_ts: '1700000000.000999',
          },
        },
      },
    });
    const file_bytes = new TextEncoder().encode('%PDF-1.4 fake report');
    const read_bytes = vi.fn(async () => file_bytes);
    slack_sdk.files_upload_v2.mockResolvedValue({
      ok: true,
      files: [{ id: 'F999', title: 'Fake report' }],
    });

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-upload_file-1',
        input: {
          file_path: 'artifacts/fake_report.pdf',
          initial_comment: 'Here is the report.',
        },
      },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
        environment: {
          env_key: 'native-slack-upload-test',
          env_kind: 'local',
          read_bytes,
        },
      },
    );

    expect(read_bytes).toHaveBeenCalledWith('artifacts/fake_report.pdf');
    expect(slack_sdk.files_upload_v2).toHaveBeenCalledWith({
      channel_id: 'C999',
      file: expect.any(Buffer),
      filename: 'fake_report.pdf',
      initial_comment: 'Here is the report.',
      thread_ts: '1700000000.000999',
    });
    expect(result).toMatchObject({
      ok: true,
      content_json: {
        output: {
          channel_id: 'C999',
          file_path: 'artifacts/fake_report.pdf',
          filename: 'fake_report.pdf',
          files: [{ id: 'F999', title: 'Fake report' }],
          thread_ts: '1700000000.000999',
        },
      },
    });
  });

  it('converts the upload comment from Markdown exactly once', async () => {
    const fixture = await create_fixture();
    const file_bytes = new TextEncoder().encode('%PDF-1.4 fake report');
    const read_bytes = vi.fn(async () => file_bytes);
    slack_sdk.files_upload_v2.mockResolvedValue({ ok: true, files: [{ id: 'F123' }] });

    await fixture.execute_tool(
      {
        node_key: 'slack-upload_file-1',
        input: {
          channel_id: 'C123',
          file_path: 'artifacts/fake_report.pdf',
          initial_comment: '**Q3** and *notes* in [the doc](https://example.com)',
        },
      },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
        environment: {
          env_key: 'native-slack-upload-test',
          env_kind: 'local',
          read_bytes,
        },
      },
    );

    expect(slack_sdk.files_upload_v2).toHaveBeenCalledWith(
      expect.objectContaining({
        initial_comment: '*Q3* and _notes_ in <https://example.com|the doc>',
      }),
    );
  });

  it('converts the message text from Markdown exactly once', async () => {
    const fixture = await create_fixture();
    slack_sdk.chat_post_message.mockResolvedValue({ ok: true, ts: '1700000000.000100' });

    await fixture.execute_tool(
      {
        node_key: 'slack-send_message-1',
        input: { channel_id: 'C123', message: '**Q3** and *notes*' },
      },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(slack_sdk.chat_post_message).toHaveBeenCalledWith(
      expect.objectContaining({ text: '*Q3* and _notes_' }),
    );
  });

  it('opens a DM and uploads there when the destination is a Slack user id', async () => {
    const fixture = await create_fixture();
    const file_bytes = new TextEncoder().encode('%PDF-1.4 spreadsheet');
    const read_bytes = vi.fn(async () => file_bytes);
    slack_sdk.conversations_open.mockResolvedValue({
      ok: true,
      channel: { id: 'D0EXAMPLE01' },
    });
    slack_sdk.files_upload_v2.mockResolvedValue({
      ok: true,
      files: [{ id: 'F555', title: 'Sample Spreadsheet' }],
    });

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-upload_file-1',
        input: {
          channel_id: 'U0EXAMPLE01',
          file_path: 'artifacts/sample_spreadsheet.xlsx',
          filename: 'sample_spreadsheet.xlsx',
          initial_comment: 'Attached is the spreadsheet.',
        },
      },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
        environment: {
          env_key: 'native-slack-upload-test',
          env_kind: 'local',
          read_bytes,
        },
      },
    );

    expect(slack_sdk.conversations_open).toHaveBeenCalledWith({ users: 'U0EXAMPLE01' });
    expect(slack_sdk.files_upload_v2).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'D0EXAMPLE01',
        filename: 'sample_spreadsheet.xlsx',
        initial_comment: 'Attached is the spreadsheet.',
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      content_json: {
        node_key: 'slack-upload_file-1',
        output: {
          channel_id: 'D0EXAMPLE01',
          file_path: 'artifacts/sample_spreadsheet.xlsx',
          filename: 'sample_spreadsheet.xlsx',
          files: [{ id: 'F555', title: 'Sample Spreadsheet' }],
        },
      },
    });
  });

  it('blocks uploading an .xlsx with uncalculated formula cells', async () => {
    const fixture = await create_fixture();
    const sheet_xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet><sheetData><row r="2">' +
      '<c r="D2" s="3"><f>C2-B2</f><v></v></c>' +
      '</row></sheetData></worksheet>';
    const file_bytes = build_stored_zip([{ name: 'xl/worksheets/sheet1.xml', content: sheet_xml }]);
    const read_bytes = vi.fn(async () => file_bytes);

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-upload_file-1',
        input: { channel_id: 'C123', file_path: 'artifacts/report.xlsx' },
      },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
        environment: { env_key: 'native-slack-upload-test', env_kind: 'local', read_bytes },
      },
    );

    expect(slack_sdk.files_upload_v2).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error_code: 'spreadsheet_not_calculated',
    });
    expect((result as { error_message: string }).error_message).toContain(
      'soffice --headless --convert-to xlsx --calc',
    );
  });

  it('uploads an .xlsx whose formulas already carry cached values', async () => {
    const fixture = await create_fixture();
    const sheet_xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet><sheetData><row r="2">' +
      '<c r="D2" s="3"><f>C2-B2</f><v>0</v></c>' +
      '<c r="D3" s="3" t="str"><f>IF(C3=0,"",C3)</f><v></v></c>' +
      '</row></sheetData></worksheet>';
    const file_bytes = build_stored_zip([{ name: 'xl/worksheets/sheet1.xml', content: sheet_xml }]);
    const read_bytes = vi.fn(async () => file_bytes);
    slack_sdk.files_upload_v2.mockResolvedValue({ ok: true, files: [{ id: 'F1' }] });

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-upload_file-1',
        input: { channel_id: 'C123', file_path: 'artifacts/report.xlsx' },
      },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
        environment: { env_key: 'native-slack-upload-test', env_kind: 'local', read_bytes },
      },
    );

    expect(slack_sdk.files_upload_v2).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true });
  });

  it('does not inherit the source thread when uploading to a resolved DM', async () => {
    const fixture = await create_fixture({
      source_context: {
        source_type: 'slack',
        source_metadata: { slack: { channel_id: 'C999', thread_ts: '1700000000.000999' } },
      },
    });
    const read_bytes = vi.fn(async () => new TextEncoder().encode('data'));
    slack_sdk.conversations_open.mockResolvedValue({ ok: true, channel: { id: 'D0EXAMPLE01' } });
    slack_sdk.files_upload_v2.mockResolvedValue({ ok: true, files: [] });

    await fixture.execute_tool(
      {
        node_key: 'slack-upload_file-1',
        input: { channel_id: 'U0EXAMPLE01', file_path: 'artifacts/report.pdf' },
      },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
        environment: { env_key: 'native-slack-upload-test', env_kind: 'local', read_bytes },
      },
    );

    expect(slack_sdk.conversations_open).toHaveBeenCalledWith({ users: 'U0EXAMPLE01' });
    const upload_args = slack_sdk.files_upload_v2.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(upload_args.channel_id).toBe('D0EXAMPLE01');
    expect(upload_args).not.toHaveProperty('thread_ts');
  });

  it('copies a file uploaded from outside the durable workspace before delivering it', async () => {
    const fixture = await create_fixture();
    const file_bytes = new TextEncoder().encode('fake xlsx bytes');
    const read_bytes = vi.fn(async () => file_bytes);
    const written_files = new Map<string, Uint8Array>();
    const write_bytes = vi.fn(async (path: string, stream: ReadableStream<Uint8Array>) => {
      written_files.set(path, new Uint8Array(await new Response(stream).arrayBuffer()));
    });
    slack_sdk.files_upload_v2.mockResolvedValue({ ok: true, files: [{ id: 'F1' }] });

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-upload_file-1',
        input: { channel_id: 'C123', file_path: '/tmp/produits_exemple.xlsx' },
      },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
        environment: {
          env_key: 'native-slack-upload-test',
          env_kind: 'local',
          read_bytes,
          write_bytes,
        },
      },
    );

    expect(write_bytes).toHaveBeenCalledWith('files/produits_exemple.xlsx', expect.anything());
    expect([...written_files.values()]).toEqual([file_bytes]);
    expect(slack_sdk.files_upload_v2).toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      content_json: {
        output: {
          file_path: '/tmp/produits_exemple.xlsx',
          durable_path: '/workspace/files/produits_exemple.xlsx',
        },
      },
    });
  });

  it('normalizes the source path and uses a safe basename for the durable copy', async () => {
    const fixture = await create_fixture();
    const read_bytes = vi.fn(async () => new TextEncoder().encode('report data'));
    const write_bytes = vi.fn(async () => {});
    slack_sdk.files_upload_v2.mockResolvedValue({ ok: true, files: [] });

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-upload_file-1',
        input: {
          channel_id: 'C123',
          file_path: '/tmp/../report.pdf',
          filename: '../../WORKSPACE.md',
        },
      },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
        environment: {
          env_key: 'native-slack-upload-test',
          env_kind: 'local',
          read_bytes,
          write_bytes,
        },
      },
    );

    expect(write_bytes).toHaveBeenCalledWith('files/WORKSPACE.md', expect.anything());
    expect(result).toMatchObject({
      ok: true,
      content_json: { output: { durable_path: '/workspace/files/WORKSPACE.md' } },
    });
  });

  it('does not copy a file that already lives in a durable directory', async () => {
    const fixture = await create_fixture();
    const read_bytes = vi.fn(async () => new TextEncoder().encode('report data'));
    const write_bytes = vi.fn(async () => {});
    slack_sdk.files_upload_v2.mockResolvedValue({ ok: true, files: [] });

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-upload_file-1',
        input: { channel_id: 'C123', file_path: 'files/report.pdf' },
      },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
        environment: {
          env_key: 'native-slack-upload-test',
          env_kind: 'local',
          read_bytes,
          write_bytes,
        },
      },
    );

    expect(write_bytes).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      content_json: { output: { file_path: 'files/report.pdf' } },
    });
    const output = (result as { content_json: { output: Record<string, unknown> } }).content_json
      .output;
    expect(output).not.toHaveProperty('durable_path');
  });

  it('still uploads the file when the durable copy fails (fail open)', async () => {
    const fixture = await create_fixture();
    const file_bytes = new TextEncoder().encode('fake xlsx bytes');
    const read_bytes = vi.fn(async () => file_bytes);
    const write_bytes = vi.fn(async () => {
      throw new Error('disk full');
    });
    slack_sdk.files_upload_v2.mockResolvedValue({ ok: true, files: [{ id: 'F1' }] });

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-upload_file-1',
        input: { channel_id: 'C123', file_path: '/tmp/produits_exemple.xlsx' },
      },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
        environment: {
          env_key: 'native-slack-upload-test',
          env_kind: 'local',
          read_bytes,
          write_bytes,
        },
      },
    );

    expect(write_bytes).toHaveBeenCalled();
    expect(slack_sdk.files_upload_v2).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true });
    const output = (result as { content_json: { output: Record<string, unknown> } }).content_json
      .output;
    expect(output).not.toHaveProperty('durable_path');
  });

  it('surfaces a Slack error when the DM cannot be opened for a user id', async () => {
    const fixture = await create_fixture();
    const read_bytes = vi.fn(async () => new TextEncoder().encode('data'));
    slack_sdk.conversations_open.mockRejectedValue(
      Object.assign(new Error('An API error occurred'), {
        data: { ok: false, error: 'cannot_dm_bot' },
      }),
    );

    const result = await fixture.execute_tool(
      {
        node_key: 'slack-upload_file-1',
        input: { channel_id: 'U0EXAMPLE01', file_path: 'artifacts/report.pdf' },
      },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
        environment: {
          env_key: 'native-slack-upload-test',
          env_kind: 'local',
          read_bytes,
        },
      },
    );

    expect(slack_sdk.conversations_open).toHaveBeenCalledWith({ users: 'U0EXAMPLE01' });
    expect(slack_sdk.files_upload_v2).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error_code: 'slack_api_error',
      error_message: 'Slack API error: cannot_dm_bot',
    });
  });

  it('joins Slack channels directly now that manual approval is disabled', async () => {
    const fixture = await create_fixture();
    slack_sdk.conversations_join.mockResolvedValue({
      ok: true,
      channel: { id: 'C123', name: 'general' },
    });

    await fixture.execute_tool(
      {
        node_key: 'slack-join_channel-1',
        input: { channel_id: 'C123' },
      },
      { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
    );

    expect(slack_sdk.conversations_join).toHaveBeenCalled();
  });
});
