import { reset_slack_workspace_cache } from '@connectors/apps/slack/list_messages/v1/execute';
import fixtures from '@connectors/apps/slack/list_messages/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/slack/list_messages/v1/node.json' with { type: 'json' };
import { execute_node } from '@connectors/runtime/execute_node';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type { ConnectorConnection } from '@connectors/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@connectors/runtime/rate_limiter', async (import_original) => {
  const original = await import_original<typeof import('@connectors/runtime/rate_limiter')>();
  return {
    ...original,
    run_under_rate_limit: <TResult>(
      _key: unknown,
      _limits: unknown,
      work: () => Promise<TResult>,
    ) => work(),
  };
});

const connection: ConnectorConnection = {
  connection_id: 'conn_slack_fixture',
  access_token: 'xoxb-test-token',
};

type SlackScript = {
  history?: Record<string, unknown | unknown[]>;
  replies?: Record<string, unknown | unknown[]>;
  join?: Record<string, unknown>;
  info?: Record<string, unknown>;
  auth?: unknown;
  users?: unknown;
};

type StubbedCall = { path: string; url: URL; body: Record<string, unknown> | null };

function build_script(answers: Record<string, unknown | unknown[]> | undefined) {
  return new Map<string, unknown[]>(
    Object.entries(answers ?? {}).map(([key, answer]) => [
      key,
      Array.isArray(answer) ? [...answer] : [answer],
    ]),
  );
}

function read_scripted(scripted: Map<string, unknown[]>, key: string) {
  const answers = scripted.get(key);
  if (!answers || answers.length === 0) return undefined;
  return answers.length > 1 ? answers.shift() : answers[0];
}

function stub_slack(script: SlackScript) {
  const calls: StubbedCall[] = [];
  const history_answers = build_script(script.history);
  const replies_answers = build_script(script.replies);

  function read_history(channel: string) {
    return read_scripted(history_answers, channel) ?? { ok: false, error: 'channel_not_found' };
  }

  function answer_for(call: StubbedCall) {
    const channel = call.url.searchParams.get('channel') ?? String(call.body?.channel ?? '');
    if (call.path.endsWith('/users.list'))
      return script.users ?? { ok: false, error: 'ratelimited' };
    if (call.path.endsWith('/conversations.replies')) {
      return (
        read_scripted(replies_answers, call.url.searchParams.get('ts') ?? '') ?? {
          ok: true,
          messages: [],
        }
      );
    }
    if (call.path.endsWith('/conversations.info')) {
      return script.info?.[channel] ?? fixtures.conversations_info_general;
    }
    if (call.path.endsWith('/auth.test')) return script.auth ?? fixtures.auth_test_ok;
    if (call.path.endsWith('/conversations.join')) return script.join?.[channel] ?? { ok: true };
    return read_history(channel);
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      const parsed = new URL(url);
      const call = {
        path: parsed.pathname,
        url: parsed,
        body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      };
      calls.push(call);
      return new Response(JSON.stringify(answer_for(call)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

function calls_to(calls: StubbedCall[], method: string) {
  return calls.filter((call) => call.path.endsWith(method));
}

type ChannelRow = {
  channel_id: string;
  channel_name: string;
  ok: boolean;
  records: Record<string, unknown>[];
  next_cursor: string | null;
  has_more: boolean;
  error_code: string | null;
  error_message: string | null;
};

type ListMessagesResult = { ok: boolean; data: { channels: ChannelRow[]; timezone: string } };

async function list_messages(input: unknown) {
  return execute_node('slack-list_messages-1', input, connection);
}

async function read_records(input: unknown): Promise<Record<string, unknown>[]> {
  const result = (await list_messages(input)) as ListMessagesResult;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result.data.channels[0]?.records ?? [];
}

function lines_of(records: Record<string, unknown>[], document_key: string): string[] {
  return records
    .filter((record) => record.document_key === document_key)
    .map((record) => record.line as string);
}

const rich_page_input = { channels: [{ channel_id: 'C012AB3CD' }] };
const rich_page_script: SlackScript = {
  history: { C012AB3CD: fixtures.conversations_history_rich_page },
  users: fixtures.users_list_page_one,
};
const thread_page_script: SlackScript = {
  history: { C012AB3CD: fixtures.conversations_history_thread_page },
  replies: { '1512104434.000490': fixtures.conversations_replies_two_days },
  users: fixtures.users_list_page_one,
};

const day_key = 'day:C012AB3CD:2017-12-01';
const thread_key = 'thread:C012AB3CD:1512104434.000490';

beforeEach(() => {
  reset_rate_limit_buckets();
  reset_slack_workspace_cache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('slack-list_messages-1 definition', () => {
  it('declares the key its folder proves, its scopes, and its calls', () => {
    expect(definition.node_key).toBe('slack-list_messages-1');
    expect(definition.required_scopes).toEqual([
      'channels:history',
      'channels:read',
      'channels:join',
      'users:read',
    ]);
    expect(definition.implementation).toBe('execute');
    expect(definition.requests.conversations_history.path).toBe('/conversations.history');
    expect(definition.requests.conversations_replies.path).toBe('/conversations.replies');
    expect(definition.requests.conversations_info.path).toBe('/conversations.info');
    expect(definition.requests.auth_test.path).toBe('/auth.test');
    expect(definition.requests.conversations_join.method).toBe('POST');
    expect(definition.requests.users_list.path).toBe('/users.list');
    expect(definition.description.trim().length).toBeGreaterThan(0);
  });

  it('carries a cursor per channel on the way in and on the way out', () => {
    expect(definition.input_schema.properties.channels.items.properties.cursor.type).toBe('string');
    expect(definition.input_schema.properties.channels.items.required).toEqual(['channel_id']);
    const channel_row = definition.output_schema.properties.channels.items;
    expect(channel_row.properties.next_cursor.type).toEqual(['string', 'null']);
    expect(channel_row.required).toContain('error_code');
  });

  it('rejects an input its own schema does not allow', async () => {
    stub_slack({});

    expect(await list_messages({ channels: [] })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(await list_messages({ channel_ids: ['C1'] })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
  });
});

describe('slack-list_messages-1 rendering', () => {
  it('renders a page as the day`s document, one line per message', async () => {
    stub_slack(rich_page_script);

    const records = await read_records(rich_page_input);

    expect(lines_of(records, day_key)).toEqual([
      '[00:52] Ada: I find you punny @Grace Hopper',
      '[00:55] Grace Hopper: fixed the & in the pricing page (https://alfera.ai/pricing) (edited) · :tada: 3 · :eyes: 1',
      '[00:56] Ada:\n  📎 venue-contract.pdf (application/pdf, 200.0 KB) [file:F0AB12CD3]',
      '[00:58] Grace Hopper: see https://alfera.ai/blog/brain\n  🔗 https://alfera.ai/blog/brain — "The company brain"',
      '[01:00] Ada: worth reading\n  ↪ forwarded from Grace Hopper (#deals, 2017-11-30T01:00:00+01:00): "the deal signed at 12k"',
    ]);
  });

  it('takes the timezone most human members share, and lets the caller override it', async () => {
    stub_slack(rich_page_script);
    const rome = (await list_messages(rich_page_input)) as ListMessagesResult;
    expect(rome.data.timezone).toBe('Europe/Rome');
    expect(rome.data.channels[0]?.records[0]).toMatchObject({
      time: '2017-12-01T00:52:30+01:00',
      day: '2017-12-01',
      document_key: day_key,
    });

    vi.unstubAllGlobals();
    stub_slack(rich_page_script);
    const tokyo = (await list_messages({
      ...rich_page_input,
      timezone: 'Asia/Tokyo',
    })) as ListMessagesResult;
    expect(tokyo.data.timezone).toBe('Asia/Tokyo');
    expect(tokyo.data.channels[0]?.records[0]).toMatchObject({
      time: '2017-12-01T08:52:30+09:00',
      day: '2017-12-01',
      document_key: 'day:C012AB3CD:2017-12-01',
    });
  });

  it('names every file on its own line and carries it for the sync engine to download', async () => {
    stub_slack(rich_page_script);

    const records = await read_records(rich_page_input);
    const file_record = records.find((record) => (record.files as unknown[]).length > 0);

    expect(file_record?.files).toEqual([
      {
        id: 'F0AB12CD3',
        name: 'venue-contract.pdf',
        mime_type: 'application/pdf',
        byte_size: 204800,
        download_url: 'https://files.slack.com/files-pri/T1-F0AB12CD3/download/venue-contract.pdf',
      },
    ]);
    expect(file_record?.file_names).toEqual(['venue-contract.pdf']);
  });

  it('renders a forwarded message as a quote, never as the poster`s own words', async () => {
    stub_slack(rich_page_script);

    const records = await read_records(rich_page_input);
    const forwarded = records.find((record) => record.forwarded_from !== null);

    expect(forwarded).toMatchObject({
      author_name: 'Ada',
      forwarded_from: {
        author: 'Grace Hopper',
        channel: '#deals',
        time: '2017-11-30T01:00:00+01:00',
        text: 'the deal signed at 12k',
      },
    });
    expect(forwarded?.line).not.toContain('Ada: Grace Hopper:');
    expect(forwarded?.unfurls).toEqual([]);
  });

  it('keeps a link preview as a url and a title', async () => {
    stub_slack(rich_page_script);

    const records = await read_records(rich_page_input);
    const unfurled = records.find((record) => (record.unfurls as unknown[]).length > 0);

    expect(unfurled?.unfurls).toEqual([
      { url: 'https://alfera.ai/blog/brain', title: 'The company brain' },
    ]);
  });

  it('marks an edit and counts the reactions', async () => {
    stub_slack(rich_page_script);

    const records = await read_records(rich_page_input);
    const edited = records.find((record) => record.is_edited === true);

    expect(edited?.reactions).toEqual([
      { name: 'tada', count: 3 },
      { name: 'eyes', count: 1 },
    ]);
    expect(edited?.line).toContain('(edited) · :tada: 3 · :eyes: 1');
  });

  it('drops join notices and Slack`s own rate-limit notice', async () => {
    stub_slack(rich_page_script);

    const records = await read_records(rich_page_input);

    expect(records.some((record) => record.subtype === 'channel_join')).toBe(false);
    expect(records.some((record) => (record.line as string).includes('not displaying'))).toBe(
      false,
    );
    expect(records).toHaveLength(5);
  });

  it('resolves every kind of Slack markup it can, and leaves what it cannot alone', async () => {
    stub_slack({
      history: {
        C012AB3CD: {
          ok: true,
          messages: [
            {
              type: 'message',
              user: 'U012AB3CDE',
              ts: '1512085950.000216',
              text: '<@U061F7AUR> <@UNKNOWN0000> <!here> <!channel> <!subteam^S0142|@design> <#C0DEALS|deals> <https://alfera.ai|Alfera> <https://alfera.ai/raw>',
            },
          ],
          response_metadata: { next_cursor: '' },
        },
      },
      users: fixtures.users_list_page_one,
    });

    const records = await read_records(rich_page_input);

    expect(records[0]?.line).toBe(
      '[00:52] Ada: @Grace Hopper <@UNKNOWN0000> @here @channel @design #deals Alfera (https://alfera.ai) https://alfera.ai/raw',
    );
  });
});

describe('slack-list_messages-1 documents', () => {
  it('files a thread as its own document and leaves a stub in the day it started', async () => {
    stub_slack(thread_page_script);

    const records = await read_records(rich_page_input);

    expect(lines_of(records, thread_key)).toEqual([
      '[06:00] Grace Hopper: can somebody review the renewal for @here?',
      '[06:05] Ada: on it',
      '— 2017-12-02 —\n[09:52] Deploybot: shipped',
    ]);
    expect(lines_of(records, day_key)).toEqual([
      '[06:00] Grace Hopper: can somebody review the renewal for @here? ↳ thread · 2 replies · last 2017-12-02T09:52:04+01:00 · [thread:C012AB3CD:1512104434.000490]',
      '[06:01] Ada: morning',
    ]);
  });

  it('says which document every line belongs to, and which day it happened on', async () => {
    stub_slack(thread_page_script);

    const records = await read_records(rich_page_input);

    expect(
      records.map((record) => ({
        key: record.document_key,
        day_key: record.day_document_key,
        thread: record.is_thread_record,
        day: record.is_day_record,
        page_ts: record.page_ts,
      })),
    ).toEqual([
      { key: thread_key, day_key, thread: true, day: false, page_ts: '1512104434.000490' },
      { key: thread_key, day_key, thread: true, day: false, page_ts: '1512104434.000490' },
      {
        key: thread_key,
        day_key: 'day:C012AB3CD:2017-12-02',
        thread: true,
        day: false,
        page_ts: '1512104434.000490',
      },
      { key: day_key, day_key, thread: false, day: true, page_ts: '1512104434.000490' },
      { key: day_key, day_key, thread: false, day: true, page_ts: '1512104500.000700' },
    ]);
  });

  it('titles each document and links it, and stamps the thread facts on every one of its lines', async () => {
    stub_slack(thread_page_script);

    const records = await read_records(rich_page_input);
    const thread_lines = records.filter((record) => record.document_key === thread_key);

    for (const line of thread_lines) {
      expect(line).toMatchObject({
        document_title: '#general · Grace Hopper: "can somebody review the renewal for @here?"',
        document_url: 'https://acme.slack.com/archives/C012AB3CD/p1512104434000490',
        thread_ts: '1512104434.000490',
        reply_count: 2,
        started_by: 'Grace Hopper',
        started_time: '2017-12-01T06:00:34+01:00',
        last_reply_time: '2017-12-02T09:52:04+01:00',
        thread_participants: ['Grace Hopper', 'Ada', 'Deploybot'],
        thread_file_count: 0,
      });
    }
    const stub = records.find((record) => (record.thread_keys as string[]).length > 0);
    expect(stub).toMatchObject({
      document_title: '#general — 2017-12-01',
      document_url: 'https://acme.slack.com/archives/C012AB3CD',
      thread_keys: [thread_key],
    });
  });

  it('builds every permalink from one auth.test, with no per-message call', async () => {
    const calls = stub_slack(thread_page_script);

    const records = await read_records(rich_page_input);

    expect(calls_to(calls, '/auth.test')).toHaveLength(1);
    expect(calls_to(calls, '/chat.getPermalink')).toHaveLength(0);
    expect(records[0]?.document_url).toBe(
      'https://acme.slack.com/archives/C012AB3CD/p1512104434000490',
    );
    expect(records[1]?.permalink).toBe(
      'https://acme.slack.com/archives/C012AB3CD/p1512104724000510?thread_ts=1512104434.000490&cid=C012AB3CD',
    );
    const stub = records.find((record) => (record.thread_keys as string[]).length > 0);
    expect(stub?.document_url).toBe('https://acme.slack.com/archives/C012AB3CD');
  });

  it('keeps the messages when the workspace host cannot be read', async () => {
    stub_slack({ ...rich_page_script, auth: { ok: false, error: 'invalid_auth' } });

    const records = await read_records(rich_page_input);

    expect(records[0]?.document_url).toBeNull();
    expect(records[0]?.permalink).toBeNull();
    expect(records[0]?.line).toContain('I find you punny');
  });

  it('takes the team domain the caller names instead of asking', async () => {
    const calls = stub_slack(rich_page_script);

    const result = (await list_messages({
      ...rich_page_input,
      team_domain: 'other',
    })) as ListMessagesResult;

    expect(calls_to(calls, '/auth.test')).toHaveLength(0);
    expect(result.data.channels[0]?.records[0]?.document_url).toBe(
      'https://other.slack.com/archives/C012AB3CD',
    );
  });

  it('reads the channel`s name once and titles the day with it', async () => {
    const calls = stub_slack(rich_page_script);

    const result = (await list_messages(rich_page_input)) as ListMessagesResult;

    expect(calls_to(calls, '/conversations.info')).toHaveLength(1);
    expect(result.data.channels[0]?.channel_name).toBe('general');
    expect(result.data.channels[0]?.records[0]?.document_title).toBe('#general — 2017-12-01');
  });
});

describe('slack-list_messages-1 batching', () => {
  it('reads the user directory once for the whole batch', async () => {
    const calls = stub_slack({
      history: {
        C012AB3CD: fixtures.conversations_history_rich_page,
        C061EG9T2: fixtures.conversations_history_last_page,
      },
      users: fixtures.users_list_page_one,
    });

    await list_messages({ channels: [{ channel_id: 'C012AB3CD' }, { channel_id: 'C061EG9T2' }] });

    expect(calls_to(calls, '/users.list')).toHaveLength(1);
  });

  it('reads the directory once for the whole crawl, not once per execute', async () => {
    const calls = stub_slack(rich_page_script);

    await list_messages(rich_page_input);
    await list_messages(rich_page_input);

    expect(calls_to(calls, '/users.list')).toHaveLength(1);
    expect(calls_to(calls, '/auth.test')).toHaveLength(1);
    expect(calls_to(calls, '/conversations.history')).toHaveLength(2);
  });

  it('drops a thread reply that also appears at top level', async () => {
    stub_slack({
      history: { C012AB3CD: fixtures.conversations_history_with_mentions },
      users: fixtures.users_list_page_one,
    });

    const records = await read_records(rich_page_input);
    expect(records.map((record) => record.ts)).toEqual(['1512085950.000216']);
  });

  it('reads the replies of EVERY thread root on the page, 500 replies a request', async () => {
    const messages = Array.from({ length: 90 }, (_, index) => ({
      type: 'message',
      user: 'U012AB3CDE',
      text: `thread ${index}`,
      ts: `15120000${String(index).padStart(2, '0')}.000100`,
      reply_count: 1,
    }));
    const calls = stub_slack({
      history: { C012AB3CD: { ok: true, messages, has_more: false } },
      replies: Object.fromEntries(
        messages.map((message) => [
          message.ts,
          { ok: true, messages: [message, { ...message, ts: `${message.ts}1`, text: 'a reply' }] },
        ]),
      ),
      users: fixtures.users_list_page_one,
    });

    const records = await read_records(rich_page_input);

    const replies_calls = calls_to(calls, '/conversations.replies');
    expect(replies_calls).toHaveLength(90);
    expect(replies_calls[0]?.url.searchParams.get('limit')).toBe('500');
    const thread_keys = new Set(
      records
        .filter((record) => record.is_thread_record === true)
        .map((record) => record.document_key as string),
    );
    expect(thread_keys.size).toBe(90);
    expect(records.filter((record) => record.is_thread_record === true)).toHaveLength(180);
  });

  it('pages a thread until Slack runs out of replies', async () => {
    const calls = stub_slack({
      history: { C012AB3CD: fixtures.conversations_history_thread_page },
      replies: {
        '1512104434.000490': [
          fixtures.conversations_replies_page_one,
          fixtures.conversations_replies_page_two,
        ],
      },
      users: fixtures.users_list_page_one,
    });

    const records = await read_records(rich_page_input);

    const replies_calls = calls_to(calls, '/conversations.replies');
    expect(replies_calls).toHaveLength(2);
    expect(replies_calls[0]?.url.searchParams.get('cursor')).toBeNull();
    expect(replies_calls[1]?.url.searchParams.get('cursor')).toBe(
      'bmV4dF90czoxNTEyMTA0NzI0MDAwNTEw',
    );
    const lines = lines_of(records, thread_key);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('on it');
    expect(lines[2]).toContain('shipped');
    expect(records.every((record) => record.replies_truncated === false)).toBe(true);
  });

  it('stops a runaway thread at the cap and says how many replies are missing', async () => {
    const root = {
      type: 'message',
      user: 'U012AB3CDE',
      text: 'the long one',
      ts: '1512104434.000490',
      thread_ts: '1512104434.000490',
      reply_count: 6000,
    };
    const pages = Array.from({ length: 10 }, (_, page) => ({
      ok: true,
      messages: Array.from({ length: 500 }, (_, index) => {
        const number = page * 500 + index;
        return {
          type: 'message',
          user: 'U061F7AUR',
          text: `reply ${number}`,
          ts: `${1512104435 + number}.000100`,
          thread_ts: root.ts,
        };
      }),
      response_metadata: { next_cursor: `page-${page + 1}` },
    }));
    const calls = stub_slack({
      history: { C012AB3CD: { ok: true, messages: [root], has_more: false } },
      replies: { [root.ts]: pages },
      users: fixtures.users_list_page_one,
    });

    const records = await read_records(rich_page_input);

    expect(calls_to(calls, '/conversations.replies')).toHaveLength(10);
    const lines = lines_of(records, `thread:C012AB3CD:${root.ts}`);
    expect(lines).toHaveLength(5001);
    expect(lines.at(-1)).toContain('… 1000 more replies not shown');
    expect(records.every((record) => record.replies_truncated === true)).toBe(true);
  });

  it('fails the channel row when a thread`s replies cannot be read', async () => {
    stub_slack({
      history: { C012AB3CD: fixtures.conversations_history_thread_page },
      replies: { '1512104434.000490': { ok: false, error: 'fatal_error' } },
      users: fixtures.users_list_page_one,
    });

    const result = (await list_messages(rich_page_input)) as ListMessagesResult;

    const channel = result.data.channels[0];
    expect(channel).toMatchObject({ ok: false, records: [], error_code: 'provider_error' });
    expect(channel?.error_message).toContain('1512104434.000490');
    expect(channel?.error_message).toContain('re-reads it');
  });

  it('sends each channel its own cursor and keeps the batch window', async () => {
    const calls = stub_slack({
      history: {
        C012AB3CD: fixtures.conversations_history_last_page,
        C061EG9T2: fixtures.conversations_history_last_page,
      },
      users: fixtures.users_list_page_one,
    });

    const result = (await list_messages({
      channels: [
        { channel_id: 'C012AB3CD', cursor: 'bmV4dF90czoxNTEyMDg1ODYxMDAwNTQz' },
        { channel_id: 'C061EG9T2' },
      ],
      limit: 2,
      oldest: '1449252889.000100',
    })) as ListMessagesResult;

    const by_channel = new Map(
      calls_to(calls, '/conversations.history').map((call) => [
        call.url.searchParams.get('channel'),
        call.url.searchParams,
      ]),
    );
    expect(by_channel.get('C012AB3CD')?.get('cursor')).toBe('bmV4dF90czoxNTEyMDg1ODYxMDAwNTQz');
    expect(by_channel.get('C061EG9T2')?.get('cursor')).toBeNull();
    expect(by_channel.get('C061EG9T2')?.get('limit')).toBe('2');
    expect(by_channel.get('C061EG9T2')?.get('oldest')).toBe('1449252889.000100');
    expect(result.data.channels.map((channel) => channel.next_cursor)).toEqual([null, null]);
  });

  it('turns an HTTP 200 ok=false into that channel row, and still reads the others', async () => {
    stub_slack({
      history: {
        C012AB3CD: fixtures.conversations_history_rich_page,
        CDELETED00: fixtures.conversations_history_channel_not_found,
      },
      users: fixtures.users_list_page_one,
    });

    const result = (await list_messages({
      channels: [{ channel_id: 'CDELETED00' }, { channel_id: 'C012AB3CD' }],
    })) as ListMessagesResult;

    expect(result.data.channels[0]).toMatchObject({
      channel_id: 'CDELETED00',
      ok: false,
      records: [],
      next_cursor: null,
      error_code: 'provider_error',
      error_message: 'Slack conversations.history answered ok=false: channel_not_found',
    });
    expect(result.data.channels[1]).toMatchObject({ channel_id: 'C012AB3CD', ok: true });
  });

  it('joins a public channel it is not in, then reads it', async () => {
    const calls = stub_slack({
      history: {
        C012AB3CD: [
          fixtures.conversations_history_not_in_channel,
          fixtures.conversations_history_last_page,
        ],
      },
      join: { C012AB3CD: fixtures.conversations_join_ok },
      users: fixtures.users_list_page_one,
    });

    const records = await read_records(rich_page_input);

    const join_calls = calls_to(calls, '/conversations.join');
    expect(join_calls).toHaveLength(1);
    expect(join_calls[0]?.body).toEqual({ channel: 'C012AB3CD' });
    expect(calls_to(calls, '/conversations.history')).toHaveLength(2);
    expect(records[0]?.line).toBe('[19:14] Ada: The first message in this channel');
  });

  it('says how to fix a private channel it cannot join', async () => {
    const calls = stub_slack({
      history: { C0PRIVATE1: fixtures.conversations_history_not_in_channel },
      join: { C0PRIVATE1: fixtures.conversations_join_private_failure },
      users: fixtures.users_list_page_one,
    });

    const result = (await list_messages({
      channels: [{ channel_id: 'C0PRIVATE1' }],
    })) as ListMessagesResult;

    expect(calls_to(calls, '/conversations.join')).toHaveLength(1);
    const channel = result.data.channels[0];
    expect(channel).toMatchObject({ ok: false, error_code: 'provider_error' });
    expect(channel?.error_message).toContain('method_not_supported_for_channel_type');
    expect(channel?.error_message).toContain('/invite @Alfera');
  });

  it('keeps the raw ids and falls back to UTC when users.list refuses', async () => {
    stub_slack({
      history: { C012AB3CD: fixtures.conversations_history_with_mentions },
      users: { ok: false, error: 'missing_scope' },
    });

    const result = (await list_messages(rich_page_input)) as ListMessagesResult;

    expect(result.data.timezone).toBe('UTC');
    expect(result.data.channels[0]?.records[0]).toMatchObject({
      author_name: 'U012AB3CDE',
      line: '[23:52] U012AB3CDE: <@U061F7AUR> can you look at the renewal?',
      day: '2017-11-30',
    });
  });
});
