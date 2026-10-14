import { model_visible_tool_text_limit_chars } from '@coworker/shared';
import {
  project_model_visible_tool_payload,
  stringify_model_visible_tool_result,
} from '@runtime-platform/tools/model_visible_tool_result';
import { describe, expect, it } from 'vitest';

function drive_search_result_data() {
  return {
    node_key: 'google_drive-search_files-1',
    app_name: 'google_drive',
    node_name: 'search_files',
    output: {
      exports: { $summary: 'Found 2 files matching "Q3 planning"' },
      ret: {
        files: [
          {
            id: '1aBcD',
            name: 'Q3 planning.docx',
            mimeType: 'application/vnd.google-apps.document',
          },
          {
            id: '2eFgH',
            name: 'Q3 planning notes',
            mimeType: 'application/vnd.google-apps.document',
          },
        ],
      },
      observations: [],
      stash_id: null,
    },
    verification: {
      status: 'not_applicable',
      reason: 'tool_input_has_no_content_expectation',
    },
  };
}

function gmail_find_email_result_data() {
  return {
    node_key: 'gmail-find_email-1',
    app_name: 'gmail',
    node_name: 'find_email',
    output: {
      exports: { $summary: 'Found 1 message' },
      ret: [{ id: '18f2', threadId: '18f2', snippet: 'Attaching the deck for Monday.' }],
      observations: [],
      stash_id: null,
    },
    verification: { status: 'not_applicable', reason: 'tool_input_has_no_content_expectation' },
  };
}

describe('project_model_visible_tool_payload', () => {
  it('unwraps a Drive search down to what the tool returned, summary first', () => {
    const payload = project_model_visible_tool_payload(drive_search_result_data());

    expect(payload).toEqual({
      summary: 'Found 2 files matching "Q3 planning"',
      files: [
        { id: '1aBcD', name: 'Q3 planning.docx', mimeType: 'application/vnd.google-apps.document' },
        {
          id: '2eFgH',
          name: 'Q3 planning notes',
          mimeType: 'application/vnd.google-apps.document',
        },
      ],
    });
    expect(Object.keys(payload as object)[0]).toBe('summary');
  });

  it('drops every envelope field the model cannot act on', () => {
    const text = JSON.stringify(project_model_visible_tool_payload(drive_search_result_data()));

    for (const envelope_field of [
      'node_key',
      'app_name',
      'node_name',
      'verification',
      'stash_id',
      'observations',
      'exports',
      'ret',
    ]) {
      expect(text).not.toContain(envelope_field);
    }
  });

  it('names a bare array return rather than hiding it', () => {
    expect(project_model_visible_tool_payload(gmail_find_email_result_data())).toEqual({
      summary: 'Found 1 message',
      result: [{ id: '18f2', threadId: '18f2', snippet: 'Attaching the deck for Monday.' }],
    });
  });

  it('keeps exports other than $summary, because the component published them on purpose', () => {
    const payload = project_model_visible_tool_payload({
      node_key: 'composio_slack-list_channels-1',
      app_name: 'composio_slack',
      node_name: 'list_channels',
      output: {
        exports: { $summary: 'Listed 1 channel', channel_count: 1 },
        ret: { channels: [{ id: 'C123', name: 'general' }] },
        observations: [],
        stash_id: null,
      },
    });

    expect(payload).toEqual({
      summary: 'Listed 1 channel',
      channel_count: 1,
      channels: [{ id: 'C123', name: 'general' }],
    });
  });

  it('unwraps the proxy read-override envelope, which carries no verification or exports', () => {
    expect(
      project_model_visible_tool_payload({
        node_key: 'google_docs-find_document-1',
        app_name: 'google_docs',
        node_name: 'find_document',
        output: { files: [{ id: '1aBcD', name: 'Q3 planning' }] },
      }),
    ).toEqual({ files: [{ id: '1aBcD', name: 'Q3 planning' }] });
  });

  it('passes a payload that is not the envelope through unchanged', () => {
    const search_tools_data = {
      tools: [{ node_key: 'google_drive-search_files-1', connection_status: 'connected' }],
      result_count: 1,
    };

    expect(project_model_visible_tool_payload(search_tools_data)).toBe(search_tools_data);
  });

  it('passes an envelope-shaped payload with an unexpected field through unchanged', () => {
    const data = { ...drive_search_result_data(), cursor: 'next_page' };

    expect(project_model_visible_tool_payload(data)).toBe(data);
  });

  it('passes non-record payloads through unchanged', () => {
    expect(project_model_visible_tool_payload('plain text')).toBe('plain text');
    expect(project_model_visible_tool_payload(null)).toBe(null);
    const list = [1, 2, 3];
    expect(project_model_visible_tool_payload(list)).toBe(list);
  });
});

describe('stringify_model_visible_tool_result', () => {
  it('cuts the transport envelope off a real Drive search', () => {
    const data = drive_search_result_data();
    const before = JSON.stringify(data);
    const after = stringify_model_visible_tool_result(data);

    expect(after.length).toBeLessThan(before.length);
    expect(after).toContain('Q3 planning.docx');
    expect(after).not.toContain('google_drive-search_files-1');
  });

  it('returns a result at the limit whole', () => {
    const data = { note: 'x'.repeat(model_visible_tool_text_limit_chars - 11) };
    const text = stringify_model_visible_tool_result(data);

    expect(text.length).toBe(model_visible_tool_text_limit_chars);
    expect(text).not.toContain('[truncated:');
  });

  it('keeps head and tail and states the loss when the result is over the limit', () => {
    const data = {
      summary: 'HEAD_MARKER',
      bulk: 'x'.repeat(400_000),
      cursor: 'TAIL_CURSOR_MARKER',
    };
    const text = stringify_model_visible_tool_result(data);

    expect(text.length).toBeLessThan(model_visible_tool_text_limit_chars + 500);
    expect(text).toContain('HEAD_MARKER');
    expect(text).toContain('TAIL_CURSOR_MARKER');
    expect(text).toContain('characters omitted from the middle');
    expect(text).toContain('cannot be read back');
    expect(text).toContain('output_fields');
  });

  it('never promises the model a way to read the dropped middle back', () => {
    const text = stringify_model_visible_tool_result({ bulk: 'x'.repeat(400_000) });

    expect(text).not.toContain('stash');
    expect(text).not.toContain('search_context');
  });

  it('caps a single oversized field instead of dropping every item after it', () => {
    const data = {
      files: [
        { name: 'first.txt', body: 'a'.repeat(400_000) },
        { name: 'second.txt', body: 'short' },
        { name: 'third.txt', body: 'short' },
      ],
    };
    const text = stringify_model_visible_tool_result(data);

    expect(text).toContain('second.txt');
    expect(text).toContain('third.txt');
  });

  it('leaves the caller its raw result byte for byte', () => {
    const data = drive_search_result_data();
    const before = JSON.stringify(data);
    stringify_model_visible_tool_result(data);

    expect(JSON.stringify(data)).toBe(before);
  });
});
