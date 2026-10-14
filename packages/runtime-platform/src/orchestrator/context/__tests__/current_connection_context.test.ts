import type { ConnectionSnapshotItem } from '@runtime-platform/connections/connection_snapshot';
import {
  connected_apps_protocol,
  create_current_connection_context,
  create_unavailable_connection_context,
  format_current_connection_context,
} from '@runtime-platform/orchestrator/context/current_connection_context';
import { build_session_context_from_messages } from '@runtime-platform/orchestrator/context_builder';
import { describe, expect, it } from 'vitest';

describe('current connection context', () => {
  it('formats accessible connections as explicit data without provider internals or secrets', () => {
    const context = create_current_connection_context([
      connection_item({
        app_name: 'attio',
        app_display_name: 'Attio',
        app_category: 'crm',
        provider_key: 'private-provider',
        external_account_name: 'sk-abcdefghijklmnopqrstuvwx1234567890',
      }),
    ]);

    const formatted = format_current_connection_context(context);

    expect(formatted).toContain('"app_name":"attio"');
    expect(formatted).toContain('"app_category":"crm"');
    expect(formatted).toContain('[redacted-secret]');
    expect(formatted).not.toContain('private-provider');
  });

  it('says a failed setup is not connected, and says nothing more for a working connection', () => {
    const failed = format_current_connection_context(
      create_current_connection_context([connection_item({ connection_status: 'failed' })]),
    );
    const working = format_current_connection_context(
      create_current_connection_context([connection_item({ connection_status: 'active' })]),
    );

    expect(failed).toContain('"connection_status":"failed"');
    expect(failed).toContain(
      '"connection_note":"The setup failed. This app is not connected and will not start working."',
    );
    expect(working).not.toContain('connection_note');
  });

  it('withholds connection and account identifiers from inaccessible connections', () => {
    const context = create_current_connection_context([
      connection_item({
        accessible: false,
        connection_id: 'conn_private_gmail',
        connection_name: 'Founder private Gmail',
        external_account_name: 'founder@example.com',
      }),
    ]);

    const formatted = format_current_connection_context(context);

    expect(formatted).toContain('"accessible":false');
    expect(formatted).not.toContain('conn_private_gmail');
    expect(formatted).not.toContain('Founder private Gmail');
    expect(formatted).not.toContain('founder@example.com');
  });

  it('selects accessible connections first and records bounded omissions', () => {
    const context = create_current_connection_context(
      [connection_item({ accessible: false }), connection_item({ connection_id: 'conn_use_me' })],
      1,
    );

    expect(context.connections).toHaveLength(1);
    expect(context.connections[0]?.connection_id).toBe('conn_use_me');
    expect(context.omitted_connection_count).toBe(1);
    expect(format_current_connection_context(context)).toContain('omitted_connection_count: 1');
  });

  it('keeps the same connections whatever order they arrive in, even at the cap', () => {
    const equally_ranked = Array.from({ length: 5 }, (_unused, index) =>
      connection_item({
        connection_id: `conn_${index}`,
        connected_time: '2026-07-18T12:00:00.000Z',
      }),
    );

    const forwards = create_current_connection_context(equally_ranked, 3);
    const backwards = create_current_connection_context([...equally_ranked].reverse(), 3);

    expect(backwards.connections.map((connection) => connection.connection_id)).toEqual([
      'conn_0',
      'conn_1',
      'conn_2',
    ]);
    expect(format_current_connection_context(backwards)).toBe(
      format_current_connection_context(forwards),
    );
  });

  it('makes snapshot failure explicit and directs the model to the live fallback tool', () => {
    const unavailable_context = create_unavailable_connection_context();
    const formatted = format_current_connection_context(unavailable_context);

    expect(formatted).toContain('snapshot_status: unavailable');
    expect(formatted).toContain('runtime-list_connections-1');
  });

  it('injects the snapshot and inference rules into the real context builder', () => {
    const current_connection_context = create_current_connection_context([
      connection_item({
        connection_id: 'conn_granola',
        app_name: 'granola',
        app_display_name: 'Granola',
      }),
      connection_item({
        connection_id: 'conn_attio',
        app_name: 'attio',
        app_display_name: 'Attio',
        app_category: 'crm',
      }),
    ]);
    const context = build_session_context_from_messages({
      workspace_id: 'wrk_1',
      session_id: 'ses_1',
      system_instructions: 'You are a coworker.',
      current_connection_context,
      messages: [
        {
          run_message_id: 'msg_1',
          message_role: 'user',
          message_content: {
            type: 'text',
            text: 'Summarize my Acme call and update my CRM.',
          },
        },
      ],
    });

    expect(context.system_prompt).toContain('## Connected Apps Protocol');
    expect(context.system_prompt).toContain('Infer the obvious source and destination');
    expect(context.system_prompt).not.toContain('## Current Connections');
    expect(context.system_prompt).not.toContain('"app_name":"granola"');

    const snapshot_text =
      context.messages.find((entry) => entry.run_message_id === 'current-connections')?.content
        .text ?? '';
    expect(snapshot_text).toContain('## Current Connections');
    expect(snapshot_text).toContain('"app_name":"granola"');
    expect(snapshot_text).toContain('"app_name":"attio"');
  });

  it('tells the model which hosts its own requests are authenticated for', () => {
    const context = create_current_connection_context([
      connection_item({ app_name: 'acme_planner', authenticated_hosts: ['www.acmebooking.com'] }),
    ]);

    const rendered = format_current_connection_context(context) ?? '';
    expect(rendered).toContain('"authenticated_hosts":["www.acmebooking.com"]');
    expect(connected_apps_protocol).toContain('never log in to them through the browser');
  });

  it('tells the model which headers it must send on its own API calls', () => {
    const context = create_current_connection_context([
      connection_item({
        app_name: 'acme_planner',
        authenticated_hosts: ['www.acmebooking.com'],
        api_protocol_headers: { 'X-Vendor-API-Version': '2019-06-10' },
      }),
    ]);

    expect(format_current_connection_context(context) ?? '').toContain(
      '"api_protocol_headers":{"X-Vendor-API-Version":"2019-06-10"}',
    );
  });

  it('hides the hosts of a connection this person may not use', () => {
    const context = create_current_connection_context([
      connection_item({ accessible: false, authenticated_hosts: [] }),
    ]);

    expect(format_current_connection_context(context) ?? '').not.toContain('authenticated_hosts');
  });
});

function connection_item(overrides: Partial<ConnectionSnapshotItem> = {}): ConnectionSnapshotItem {
  return {
    connection_id: 'conn_1',
    app_name: 'gmail',
    app_display_name: 'Gmail',
    app_category: 'communication',
    connection_name: 'Team account',
    connection_status: 'active',
    authenticated_hosts: [],
    api_protocol_headers: {},
    health_status: 'healthy',
    provider_key: 'native',
    external_account_name: 'team@example.com',
    connected_time: '2026-07-18T12:00:00.000Z',
    accessible: true,
    ...overrides,
  };
}
