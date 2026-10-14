import fixtures from '@connectors/apps/slack/send_messages/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/slack/send_messages/v1/node.json' with { type: 'json' };
import { execute_node } from '@connectors/runtime/execute_node';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type { ConnectorConnection } from '@connectors/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connection: ConnectorConnection = {
  connection_id: 'conn_slack_fixture',
  access_token: 'xoxb-test-token',
};

type PostedMessage = { channel: string; text: string; thread_ts?: string };

type SlackPostRecorder = {
  posted: PostedMessage[];
  peak_in_flight_per_channel: Map<string, number>;
};

function stub_slack_posts(responses_by_channel: Record<string, unknown[]>): SlackPostRecorder {
  const recorder: SlackPostRecorder = { posted: [], peak_in_flight_per_channel: new Map() };
  const in_flight = new Map<string, number>();
  const remaining = new Map(
    Object.entries(responses_by_channel).map(([channel, list]) => [channel, [...list]]),
  );

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const posted = JSON.parse(String(init.body)) as PostedMessage;
      recorder.posted.push(posted);

      const running = (in_flight.get(posted.channel) ?? 0) + 1;
      in_flight.set(posted.channel, running);
      recorder.peak_in_flight_per_channel.set(
        posted.channel,
        Math.max(recorder.peak_in_flight_per_channel.get(posted.channel) ?? 0, running),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      in_flight.set(posted.channel, running - 1);

      const body = remaining.get(posted.channel)?.shift() ?? {
        ok: false,
        error: 'channel_not_found',
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return recorder;
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('slack-send_messages-1 definition', () => {
  it('declares the key its folder proves, its scope, and its call', () => {
    expect(definition.node_key).toBe('slack-send_messages-1');
    expect(definition.required_scopes).toEqual(['chat:write']);
    expect(definition.implementation).toBe('execute');
    expect(definition.requests.post_message.method).toBe('POST');
    expect(definition.requests.post_message.path).toBe('/chat.postMessage');
    expect(definition.description.trim().length).toBeGreaterThan(0);
  });

  it('takes an array of messages in and returns one row per message', () => {
    expect(definition.input_schema.required).toEqual(['messages']);
    expect(definition.input_schema.properties.messages.type).toBe('array');
    expect(definition.input_schema.properties.messages.minItems).toBe(1);
    expect(definition.output_schema.properties.results.type).toBe('array');
    expect(definition.output_schema.properties.results.items.required).toContain('index');
  });

  it('rejects an input its own schema does not allow', async () => {
    stub_slack_posts({});

    for (const input of [
      { messages: [] },
      { messages: [{ channel_id: 'C1' }] },
      { messages: [{ channel_id: '', text: 'x' }] },
    ]) {
      expect(await execute_node('slack-send_messages-1', input, connection)).toMatchObject({
        ok: false,
        error: { code: 'invalid_input' },
      });
    }
  });
});

describe('slack-send_messages-1', () => {
  it('sends a batch and returns one result row per message', async () => {
    stub_slack_posts({
      C012AB3CD: [fixtures.post_message_ok, fixtures.post_message_thread_reply_ok],
      C061EG9T2: [fixtures.post_message_second_channel_ok],
    });

    const result = await execute_node(
      'slack-send_messages-1',
      {
        messages: [
          { channel_id: 'C012AB3CD', text: "Here's a message for you" },
          { channel_id: 'C061EG9T2', text: 'A message for the other channel' },
          {
            channel_id: 'C012AB3CD',
            text: 'Replying in the thread',
            thread_ts: '1503435956.000247',
          },
        ],
      },
      connection,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        results: [
          {
            index: 0,
            channel_id: 'C012AB3CD',
            ok: true,
            message_ts: '1503435956.000247',
            thread_ts: null,
            error_code: null,
            error_message: null,
          },
          {
            index: 1,
            channel_id: 'C061EG9T2',
            ok: true,
            message_ts: '1503435958.000411',
            thread_ts: null,
            error_code: null,
            error_message: null,
          },
          {
            index: 2,
            channel_id: 'C012AB3CD',
            ok: true,
            message_ts: '1503435957.000300',
            thread_ts: '1503435956.000247',
            error_code: null,
            error_message: null,
          },
        ],
      },
    });
  });

  it('never overlaps two messages in one channel, and does overlap two channels', async () => {
    const recorder = stub_slack_posts({
      C012AB3CD: [fixtures.post_message_ok, fixtures.post_message_thread_reply_ok],
      C061EG9T2: [fixtures.post_message_second_channel_ok],
    });

    await execute_node(
      'slack-send_messages-1',
      {
        messages: [
          { channel_id: 'C012AB3CD', text: 'first' },
          { channel_id: 'C012AB3CD', text: 'second' },
          { channel_id: 'C061EG9T2', text: 'other channel' },
        ],
      },
      connection,
    );

    expect(recorder.peak_in_flight_per_channel.get('C012AB3CD')).toBe(1);
    expect(recorder.posted.map((message) => message.channel)).toEqual([
      'C012AB3CD',
      'C061EG9T2',
      'C012AB3CD',
    ]);
    expect(
      recorder.posted.filter((message) => message.channel === 'C012AB3CD').map((m) => m.text),
    ).toEqual(['first', 'second']);
  });

  it('turns an HTTP 200 ok=false into that message row, and still sends the others', async () => {
    stub_slack_posts({
      C012AB3CD: [fixtures.post_message_ok],
      CDELETED00: [fixtures.post_message_channel_not_found],
    });

    const result = await execute_node(
      'slack-send_messages-1',
      {
        messages: [
          { channel_id: 'CDELETED00', text: 'into the void' },
          { channel_id: 'C012AB3CD', text: "Here's a message for you" },
        ],
      },
      connection,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        results: [
          {
            index: 0,
            channel_id: 'CDELETED00',
            ok: false,
            message_ts: null,
            thread_ts: null,
            error_code: 'provider_error',
            error_message: 'Slack chat.postMessage answered ok=false: channel_not_found',
          },
          {
            index: 1,
            channel_id: 'C012AB3CD',
            ok: true,
            message_ts: '1503435956.000247',
            thread_ts: null,
            error_code: null,
            error_message: null,
          },
        ],
      },
    });
  });

  it('reports a refused token as unauthorized on the message row', async () => {
    stub_slack_posts({ C012AB3CD: [fixtures.post_message_invalid_auth] });

    const result = await execute_node(
      'slack-send_messages-1',
      { messages: [{ channel_id: 'C012AB3CD', text: 'hello' }] },
      connection,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          {
            index: 0,
            ok: false,
            error_code: 'unauthorized',
            error_message: 'Slack chat.postMessage answered ok=false: invalid_auth',
          },
        ],
      },
    });
  });
});
