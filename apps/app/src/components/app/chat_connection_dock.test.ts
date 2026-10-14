import { describe, expect, it } from 'vitest';
import {
  connected_app_times,
  connection_bar_content_kind,
  is_connected_app,
  latest_connection_requests,
  read_connection_setup_tool_output,
  read_pending_connection_id,
} from '@/components/app/chat_connection_dock';
import type {
  ProjectedChatMessage,
  ProjectedChatToolPart,
} from '@/components/app/chat_stream_projection';
import { connection_ask_visibility } from '@/components/app/connection_ask_visibility';
import type { Connection } from '@/lib/api';

const notion_app = {
  app_id: 'app_00000000000000000000000000000001',
  app_name: 'notion',
  app_display_name: 'Notion',
  icon_url: 'https://example.com/gmail.png',
};
const notion_start_url =
  'http://app.localhost:3000/connect/start?connection_id=conn_01000000000000000000000001&setup_token=wOq';
const notion_setup_payload = {
  type: 'connection_setup',
  app: notion_app,
  start_url: notion_start_url,
  message_for_user: `Open this link to connect Notion: ${notion_start_url}`,
};
const old_ask_time = '2026-07-01T09:00:00.000Z';
const new_ask_time = '2026-08-02T21:00:00.000Z';
const structured_tool_output = { data: notion_setup_payload, success: true, metadata: {} };
const content_block_tool_output = {
  content: [{ type: 'text', text: JSON.stringify(notion_setup_payload) }],
  details: { tool_call_id: 'tcall_01000000000000000000000002' },
};

describe('connected_app_times', () => {
  it('counts only an active connection as connected', () => {
    const connections = [
      connection({ connection_status: 'active', app_name: 'slack' }),
      connection({ connection_status: 'pending_setup', app_name: 'gmail' }),
      connection({ connection_status: 'revoked', app_name: 'notion' }),
    ];

    expect(Object.keys(connected_app_times(connections))).toEqual(['slack']);
  });

  it('normalizes the app name the way the dock compares against a request', () => {
    const connections = [connection({ connection_status: 'active', app_name: 'Google Sheets' })];

    expect(Object.keys(connected_app_times(connections))).toEqual(['googlesheets']);
  });

  it('keeps the newest connection time for an app connected more than once', () => {
    const connections = [
      connection({ connection_status: 'active', app_name: 'gmail', connected_time: old_ask_time }),
      connection({ connection_status: 'active', app_name: 'gmail', connected_time: new_ask_time }),
    ];

    expect(connected_app_times(connections).gmail).toBe(Date.parse(new_ask_time));
  });

  it('keeps the app_id too, so a request matches even when the two names disagree', () => {
    const connections = [
      connection({ connection_status: 'active', app_name: 'notion', app_id: notion_app.app_id }),
    ];

    expect(is_connected_app(notion_app, connected_app_times(connections))).toBe(true);
    expect(
      is_connected_app(
        { app_id: notion_app.app_id, app_name: 'notion_v2', app_display_name: 'Notion' },
        connected_app_times(connections),
      ),
    ).toBe(true);
  });

  it('matches on the normalized name when the two sides disagree on app_id', () => {
    const connections = [
      connection({ connection_status: 'active', app_name: 'google_sheets', app_id: 'app_old' }),
    ];

    expect(
      is_connected_app(
        { app_id: 'app_new', app_name: 'Google Sheets', app_display_name: 'Google Sheets' },
        connected_app_times(connections),
      ),
    ).toBe(true);
  });

  it('leaves a pending_setup row asking: that row IS the unfinished request', () => {
    const connections = [
      connection({
        connection_status: 'pending_setup',
        app_name: 'notion',
        app_id: notion_app.app_id,
      }),
    ];

    expect(is_connected_app(notion_app, connected_app_times(connections))).toBe(false);
  });
});

describe('is_connected_app, per request', () => {
  const gmail_app = { app_name: 'gmail', app_display_name: 'Gmail' };

  it('suppresses an ask a connection landed after', () => {
    const connected = connected_app_times([
      connection({ connection_status: 'active', app_name: 'gmail', connected_time: new_ask_time }),
    ]);

    expect(is_connected_app(gmail_app, connected, Date.parse(new_ask_time) - 5_000)).toBe(true);
  });

  it('keeps asking for a second account: every active connection is older than the ask', () => {
    const connected = connected_app_times([
      connection({ connection_status: 'active', app_name: 'gmail', connected_time: old_ask_time }),
    ]);

    expect(is_connected_app(gmail_app, connected, Date.parse(new_ask_time))).toBe(false);
  });

  it('flips to a receipt once the new connection lands after the ask', () => {
    const requested_ms = Date.parse(new_ask_time);
    const after_the_click = connected_app_times([
      connection({ connection_status: 'active', app_name: 'gmail', connected_time: old_ask_time }),
      connection({
        connection_status: 'active',
        app_name: 'gmail',
        connected_time: '2026-08-02T21:05:00.000Z',
      }),
    ]);

    expect(is_connected_app(gmail_app, after_the_click, requested_ms)).toBe(true);
  });

  it('tolerates a minute of clock skew between the two sides', () => {
    const connected = connected_app_times([
      connection({ connection_status: 'active', app_name: 'gmail', connected_time: new_ask_time }),
    ]);
    const requested_ms = Date.parse(new_ask_time);

    expect(is_connected_app(gmail_app, connected, requested_ms + 30_000)).toBe(true);
    expect(is_connected_app(gmail_app, connected, requested_ms + 120_000)).toBe(false);
  });
});

describe('latest_connection_requests, timing', () => {
  it('dates an ask by the tool call it arrived with', () => {
    const [request] = latest_connection_requests([
      assistant_message([
        {
          ...connection_tool_part('run:tool:toolu_1', structured_tool_output),
          createdTime: new_ask_time,
        },
      ]),
    ]);

    expect(request?.requested_ms).toBe(Date.parse(new_ask_time));
  });

  it('takes the earliest time when the same ask arrives twice', () => {
    const [request] = latest_connection_requests([
      assistant_message([
        {
          ...connection_tool_part('tcall_1', content_block_tool_output),
          createdTime: '2026-08-02T21:00:10.000Z',
        },
        {
          ...connection_tool_part('run:tool:toolu_1', structured_tool_output),
          createdTime: new_ask_time,
        },
      ]),
    ]);

    expect(request?.requested_ms).toBe(Date.parse(new_ask_time));
  });
});

describe('connection_bar_content_kind', () => {
  it('starts on the full ask', () => {
    expect(
      connection_bar_content_kind({ hasStartedSetup: false, isConnected: false, isSlim: false }),
    ).toBe('full');
  });

  it('slims instead of disappearing when the reader says "Not now" — the Connect button stays reachable', () => {
    const kind = connection_bar_content_kind({
      hasStartedSetup: false,
      isConnected: false,
      isSlim: true,
    });
    expect(kind).toBe('slim');
    expect(kind).not.toBe('full');
  });

  it('moves to signing-in once Connect is clicked, from either the full or the slim ask', () => {
    expect(
      connection_bar_content_kind({ hasStartedSetup: true, isConnected: false, isSlim: false }),
    ).toBe('signing_in');
    expect(
      connection_bar_content_kind({ hasStartedSetup: true, isConnected: false, isSlim: true }),
    ).toBe('signing_in');
  });

  it('shows the receipt the moment the connection lands, overriding every other state', () => {
    expect(
      connection_bar_content_kind({ hasStartedSetup: true, isConnected: true, isSlim: true }),
    ).toBe('receipt');
  });
});

describe('read_connection_setup_tool_output', () => {
  it('reads the shape runtime-add_mcp_server-1 returns for a server needing a sign-in', () => {
    const output = read_connection_setup_tool_output({
      data: {
        type: 'connection_setup',
        kind: 'needs_authorization',
        app: {
          app_id: 'app_mcp_deepwiki',
          app_name: 'mcp_deepwiki',
          app_display_name: 'DeepWiki',
          icon_url: 'https://mcp.deepwiki.com/icon.png',
        },
        start_url: 'https://app.example.com/connect/start?connection_id=conn_1&setup_token=abc',
        message_for_user: 'DeepWiki needs you to sign in first: https://app.example.com/...',
      },
    });

    expect(output).toEqual({
      app: {
        app_id: 'app_mcp_deepwiki',
        app_name: 'mcp_deepwiki',
        app_display_name: 'DeepWiki',
        icon_url: 'https://mcp.deepwiki.com/icon.png',
      },
      start_url: 'https://app.example.com/connect/start?connection_id=conn_1&setup_token=abc',
    });
  });

  it('reads a connection_setup payload nested under data', () => {
    const output = read_connection_setup_tool_output({
      data: {
        type: 'connection_setup',
        app: { app_name: 'slack', app_display_name: 'Slack' },
        start_url: 'https://app.example.com/connect/start?app_name=slack',
      },
    });

    expect(output?.app.app_display_name).toBe('Slack');
    expect(output?.start_url).toBe('https://app.example.com/connect/start?app_name=slack');
  });

  it('reads a connection_setup payload nested under content_json', () => {
    const output = read_connection_setup_tool_output({
      content_json: {
        type: 'connection_setup',
        app: { app_name: 'gmail', app_display_name: 'Gmail' },
        start_url: 'https://app.example.com/connect/start?app_name=gmail',
      },
    });

    expect(output?.app.app_name).toBe('gmail');
  });

  it('reads the provider content-block shape the same call is re-announced in', () => {
    const from_structured = read_connection_setup_tool_output(structured_tool_output);
    const from_content_block = read_connection_setup_tool_output(content_block_tool_output);

    expect(from_content_block).toEqual(from_structured);
    expect(from_content_block?.start_url).toBe(notion_start_url);
    expect(from_content_block?.app.app_id).toBe(notion_app.app_id);
  });

  it('is null for a tool output that is not a connection setup', () => {
    expect(read_connection_setup_tool_output({ rows: 3 })).toBeNull();
    expect(read_connection_setup_tool_output({ content: [{ text: 'not json' }] })).toBeNull();
    expect(read_connection_setup_tool_output(undefined)).toBeNull();
  });
});

describe('latest_connection_requests', () => {
  it('asks once per app, however many tool calls carried the same request', () => {
    const requests = latest_connection_requests([
      assistant_message([
        connection_tool_part('run:tool:toolu_1', structured_tool_output),
        connection_tool_part('tcall_01000000000000000000000002', content_block_tool_output),
      ]),
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.app_key).toBe('notion');
  });

  it('forgets a request the reader waved off, whichever tool call brings it back', () => {
    const messages = [assistant_message([connection_tool_part('tcall_2', structured_tool_output)])];

    expect(latest_connection_requests(messages, ['notion'])).toEqual([]);
  });

  it('stops asking once a newer assistant turn has nothing to ask for', () => {
    const messages = [
      assistant_message([connection_tool_part('tcall_2', structured_tool_output)]),
      { id: 'msg_user', role: 'user' as const, parts: [{ type: 'text' as const, text: 'It did' }] },
      {
        id: 'msg_newer',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'Confirmed, Notion is active and healthy.' }],
      },
    ];

    expect(latest_connection_requests(messages)).toEqual([]);
  });
});

function assistant_message(parts: ProjectedChatMessage['parts']): ProjectedChatMessage {
  return { id: 'msg_assistant', role: 'assistant', parts };
}

function connection_tool_part(tool_call_id: string, output: unknown): ProjectedChatToolPart {
  return {
    type: 'tool-runtime-create_connection-1',
    toolCallId: tool_call_id,
    toolName: 'runtime-create_connection-1',
    state: 'completed',
    output,
  };
}

function connection(input: {
  app_id?: string;
  app_name: string;
  connected_time?: string;
  connection_status: string;
}): Connection {
  return {
    connection_status: input.connection_status,
    connected_time: input.connected_time ?? null,
    created_time: input.connected_time ?? old_ask_time,
    ...(input.app_id ? { app_id: input.app_id } : {}),
    app: { app_name: input.app_name, ...(input.app_id ? { app_id: input.app_id } : {}) },
  } as unknown as Connection;
}

describe('read_pending_connection_id', () => {
  it('reads the pending connection out of the start link', () => {
    expect(
      read_pending_connection_id(
        'http://app.localhost:3000/connect/start?connection_id=conn_00000000001&setup_token=wOq',
      ),
    ).toBe('conn_00000000001');
  });

  it('answers null for a link it cannot read, rather than throwing inside a click', () => {
    expect(read_pending_connection_id('not-a-url')).toBeNull();
    expect(read_pending_connection_id('https://example.com/connect/start')).toBeNull();
  });
});

describe('connection_ask_visibility', () => {
  const pending_id = 'conn_01000000000000000000000001';
  const pending_row = pending_connection(pending_id);

  it('shows an ask whose pending row is still in the list', () => {
    expect(
      connection_ask_visibility({
        connection_id: pending_id,
        connections: [pending_row],
        has_rechecked: false,
        is_connected: false,
        list_postdates_ask: false,
      }),
    ).toBe('show');
  });

  it('rechecks before hiding an ask the list has never carried: the row is made mid-run', () => {
    expect(
      connection_ask_visibility({
        connection_id: pending_id,
        connections: [],
        has_rechecked: false,
        is_connected: false,
        list_postdates_ask: false,
      }),
    ).toBe('recheck');
  });

  it('hides a cancelled or expired setup once a re-read agrees the row is gone', () => {
    expect(
      connection_ask_visibility({
        connection_id: pending_id,
        connections: [pending_connection('conn_other')],
        has_rechecked: true,
        is_connected: false,
        list_postdates_ask: false,
      }),
    ).toBe('hide');
  });

  it('keeps the receipt on screen even though the row is no longer pending anything', () => {
    expect(
      connection_ask_visibility({
        connection_id: pending_id,
        connections: [],
        has_rechecked: true,
        is_connected: true,
        list_postdates_ask: false,
      }),
    ).toBe('show');
  });

  it('paints nothing while the connections list has not answered yet', () => {
    expect(
      connection_ask_visibility({
        connection_id: pending_id,
        connections: undefined,
        has_rechecked: true,
        is_connected: false,
        list_postdates_ask: false,
      }),
    ).toBe('hide');
  });

  it('treats absence as final when the list postdates the ask', () => {
    expect(
      connection_ask_visibility({
        connection_id: pending_id,
        connections: [],
        has_rechecked: false,
        is_connected: false,
        list_postdates_ask: true,
      }),
    ).toBe('hide');
  });

  it('still rechecks a fresh ask the cached list genuinely predates', () => {
    expect(
      connection_ask_visibility({
        connection_id: pending_id,
        connections: [],
        has_rechecked: false,
        is_connected: false,
        list_postdates_ask: false,
      }),
    ).toBe('recheck');
  });

  it('leaves an older app_name-only setup link alone: there is no row to look for', () => {
    expect(
      connection_ask_visibility({
        connection_id: null,
        connections: [],
        has_rechecked: true,
        is_connected: false,
        list_postdates_ask: false,
      }),
    ).toBe('show');
  });
});

function pending_connection(connection_id: string): Connection {
  return {
    connection_id,
    connection_status: 'pending_setup',
    app: { app_name: 'notion' },
  } as unknown as Connection;
}
