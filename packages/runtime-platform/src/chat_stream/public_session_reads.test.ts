import {
  public_agent_run_stream_event,
  public_run_event,
} from '@runtime-platform/chat_stream/public_run_output';
import {
  bounded_wire_value,
  public_persisted_chat_event,
  public_session_message,
  public_tool_call,
  wire_json_char_cap,
} from '@runtime-platform/chat_stream/public_session_reads';
import { describe, expect, it } from 'vitest';

const fat_text = 'x'.repeat(wire_json_char_cap + 1_000);

describe('bounded_wire_value', () => {
  it('ships values under the cap verbatim', () => {
    const value = { rows: [1, 2, 3], note: 'small' };
    expect(bounded_wire_value(value, [])).toBe(value);
  });

  it('replaces oversized values with a marker that keeps label keys', () => {
    const value = { blob: fat_text, node_name: 'gmail-find_email', display: { title: 'Gmail' } };
    const bounded = bounded_wire_value(value, ['node_name', 'display']) as Record<string, unknown>;

    expect(bounded.wire_truncated).toBe(true);
    expect(bounded.original_chars).toBeGreaterThan(wire_json_char_cap);
    expect(typeof bounded.preview).toBe('string');
    expect(bounded.node_name).toBe('gmail-find_email');
    expect(bounded.display).toEqual({ title: 'Gmail' });
    expect(bounded.blob).toBeUndefined();
  });

  it('keeps null and undefined as they are', () => {
    expect(bounded_wire_value(null, [])).toBeNull();
    expect(bounded_wire_value(undefined, [])).toBeUndefined();
  });
});

describe('public_tool_call', () => {
  const stored_tool_call = {
    tool_call_id: 'tcall_1',
    workspace_id: 'wrk_1',
    session_id: 'ses_1',
    run_id: 'run_1',
    agent_id: 'agt_1',
    node_id: null,
    connection_id: null,
    tool_name: 'docs-get_document-1',
    node_version: null,
    tool_status: 'completed',
    risk_class: 'read',
    approval_mode: 'auto',
    input_data: { document_id: 'doc_1' },
    output_data: { body: fat_text, data: { node_name: 'docs-get_document' } },
    output_text: null,
    output_file_id: null,
    error_code: null,
    error_message: null,
    duration_ms: 1200,
    tool_call_metadata: {},
    metadata: {},
    created_time: new Date('2026-08-02T10:00:00Z'),
    started_time: null,
    completed_time: null,
    finished_time: null,
    created_by: 'test',
    last_updated_time: new Date('2026-08-02T10:00:00Z'),
    last_updated_by: 'test',
  };

  it('bounds fat payloads and drops columns the client never reads', () => {
    const wire = public_tool_call(stored_tool_call) as Record<string, unknown>;

    expect(wire.tool_call_id).toBe('tcall_1');
    expect(wire.input_data).toEqual({ document_id: 'doc_1' });
    expect((wire.output_data as Record<string, unknown>).wire_truncated).toBe(true);
    expect((wire.output_data as Record<string, unknown>).data).toEqual({
      node_name: 'docs-get_document',
    });
    for (const dropped of ['workspace_id', 'agent_id', 'risk_class', 'metadata', 'created_by']) {
      expect(dropped in wire).toBe(false);
    }
  });

  it('keeps the error code: the chat reads it to tell an exit code from a failed step', () => {
    const wire = public_tool_call({ ...stored_tool_call, error_code: 'command_failed' });

    expect(wire.error_code).toBe('command_failed');
  });

  it('never truncates a connection_setup payload', () => {
    const wire = public_tool_call({
      ...stored_tool_call,
      output_data: {
        type: 'connection_setup',
        start_url: 'https://connect.example/start',
        app: { app_id: 'app_1', app_display_name: 'Gmail' },
        padding: fat_text,
      },
    }) as Record<string, unknown>;

    expect((wire.output_data as Record<string, unknown>).type).toBe('connection_setup');
    expect((wire.output_data as Record<string, unknown>).start_url).toBe(
      'https://connect.example/start',
    );
  });
});

describe('public_session_message', () => {
  it('bounds tool_result payloads and keeps human-visible parts verbatim', () => {
    const wire = public_session_message({
      run_message_id: 'msg_1',
      workspace_id: 'wrk_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      message_role: 'tool_result',
      message_kind: 'message',
      message_content: {
        type: 'multimodal',
        parts: [
          { type: 'text', text: 'small text stays' },
          { type: 'tool_result', result: { content_text: fat_text, content_json: { a: 1 } } },
        ],
      },
      content_text: fat_text,
      content_json: null,
      provider_item_id: null,
      provider_call_id: null,
      token_count: null,
      metadata: {},
      tool_call_id: 'tcall_1',
      is_user_visible: true,
      is_model_visible: true,
      source_type: 'api',
      source_metadata: {},
      message_sequence: 3,
      run_message_sequence: 3,
      created_time: new Date('2026-08-02T10:00:00Z'),
      created_by: 'test',
      last_updated_time: new Date('2026-08-02T10:00:00Z'),
      last_updated_by: 'test',
    }) as Record<string, unknown>;

    const content = wire.message_content as { parts: Array<Record<string, unknown>> };
    expect(content.parts[0]).toEqual({ type: 'text', text: 'small text stays' });
    const result = content.parts[1]?.result as Record<string, unknown>;
    expect(String(result.content_text)).toContain('[truncated');
    expect(result.content_json).toEqual({ a: 1 });
    expect('content_text' in wire).toBe(false);
    expect('metadata' in wire).toBe(false);
    expect(wire.is_user_visible).toBe(true);
  });
});

describe('public_persisted_chat_event', () => {
  it('bounds tool item payloads inside item events', () => {
    const event = {
      event_id: 'evt_1',
      sequence: 5,
      event_type: 'item_completed',
      run_id: 'run_1',
      occurred_time: '2026-08-02T10:00:00Z',
      item: {
        item_id: 'item_1',
        item_type: 'tool_call',
        tool_name: 'docs-get_document-1',
        input_data: { document_id: 'doc_1' },
        output_data: { body: fat_text },
      },
    };

    const wire = public_persisted_chat_event(event as never) as unknown as typeof event;
    expect(wire.item.input_data).toEqual({ document_id: 'doc_1' });
    expect((wire.item.output_data as Record<string, unknown>).wire_truncated).toBe(true);
  });

  it('leaves run lifecycle events untouched', () => {
    const event = { event_id: 'evt_2', sequence: 6, event_type: 'run_completed', run_id: 'run_1' };
    expect(public_persisted_chat_event(event as never)).toBe(event);
  });
});

describe('page-read columns and the reducer agree', () => {
  const columns_selected_by_the_page_read = [
    'run_message_id',
    'session_id',
    'run_id',
    'message_role',
    'message_kind',
    'message_content',
    'tool_call_id',
    'is_model_visible',
    'is_user_visible',
    'source_type',
    'source_metadata',
    'message_sequence',
    'run_message_sequence',
    'created_time',
  ] as const;

  it('sends every selected column and invents none', () => {
    const row = Object.fromEntries(
      columns_selected_by_the_page_read.map((column) => [
        column,
        column === 'message_content' ? { type: 'text', text: 'hi' } : `value_${column}`,
      ]),
    ) as Parameters<typeof public_session_message>[0];

    const wire = public_session_message(row);

    expect(Object.keys(wire).sort()).toEqual([...columns_selected_by_the_page_read].sort());
  });

  it('still drops the wide columns when a caller selects whole rows', () => {
    const whole_row = {
      run_message_id: 'msg_1',
      message_content: { type: 'text', text: 'hi' },
      content_text: 'text',
      content_json: { bulk: 'x' },
      provider_item_id: 'p1',
      provider_call_id: 'p2',
      token_count: 5,
      metadata: {},
      workspace_id: 'ws_1',
      created_by: 'user_1',
      last_updated_time: 'now',
      last_updated_by: 'user_1',
    };

    const wire = public_session_message(whole_row);

    expect(wire).not.toHaveProperty('content_json');
    expect(wire).not.toHaveProperty('workspace_id');
    expect(wire).toHaveProperty('run_message_id', 'msg_1');
  });
});

describe('a Brain search answer on the wire', () => {
  const brain_search_output = build_brain_search_output();
  const brain_read_output = build_brain_read_output();

  const stored_brain_call = {
    tool_call_id: 'tcall_brain',
    workspace_id: 'wrk_1',
    session_id: 'ses_1',
    run_id: 'run_1',
    agent_id: 'agt_1',
    node_id: null,
    connection_id: null,
    tool_name: 'runtime-search_documents-1',
    node_version: null,
    tool_status: 'completed',
    risk_class: 'read',
    approval_mode: 'auto',
    input_data: { query: 'renewal deadline' },
    output_data: brain_search_output,
    output_text: JSON.stringify(brain_search_output.data),
    output_file_id: null,
    error_code: null,
    error_message: null,
    duration_ms: 900,
    tool_call_metadata: {},
    metadata: {},
    created_time: new Date('2026-09-08T10:00:00Z'),
    started_time: null,
    completed_time: null,
    finished_time: null,
    created_by: 'test',
    last_updated_time: new Date('2026-09-08T10:00:00Z'),
    last_updated_by: 'test',
  };

  it('is the size that made this necessary', () => {
    expect(JSON.stringify(brain_search_output).length).toBeGreaterThan(24_000);
    expect(JSON.stringify(brain_search_output).length).toBeGreaterThan(wire_json_char_cap);
    expect(JSON.stringify(brain_search_output.data.display).length).toBeGreaterThan(2_000);
  });

  it('sends the summary and the sources, and none of the passages', () => {
    const wire = public_tool_call(stored_brain_call) as Record<string, unknown>;
    const output = wire.output_data as Record<string, unknown>;

    expect(output.wire_truncated).toBe(true);
    expect(output.original_chars).toBe(JSON.stringify(brain_search_output).length);
    expect(output.preview).toBe('Searched Brain · 10 sources');
    expect(output.data).toEqual({ display: brain_search_output.data.display });
    expect(JSON.stringify(wire)).not.toContain('renewal deadline for the Milan venue');
    expect(wire.output_text).toBe('Searched Brain · 10 sources');
  });

  it('cuts a read that would have fitted, because size is not the question', () => {
    const wire = public_tool_call({
      ...stored_brain_call,
      tool_name: 'runtime-read_document-1',
      output_data: brain_read_output,
      output_text: JSON.stringify(brain_read_output.data),
    }) as Record<string, unknown>;
    const output = wire.output_data as Record<string, unknown>;

    expect(JSON.stringify(brain_read_output).length).toBeLessThan(wire_json_char_cap);
    expect(output.data).toEqual({ display: brain_read_output.data.display });
    expect(JSON.stringify(wire)).not.toContain('The supplier pays the licensing fee');
  });

  it('lets a failed brain call say why, because there is nothing to cut', () => {
    const wire = public_tool_call({
      ...stored_brain_call,
      output_data: {
        success: false,
        error: {
          code: 'brain_call_budget_spent',
          message: "That's enough of the library for one answer — ask a narrower question.",
        },
      },
      output_text: 'brain_call_budget_spent',
    }) as Record<string, unknown>;

    expect(JSON.stringify(wire.output_data)).toContain('ask a narrower question');
  });

  it('cuts the same answer inside a chat stream item', () => {
    const event = {
      event_id: 'evt_brain',
      sequence: 7,
      event_type: 'item_completed',
      run_id: 'run_1',
      occurred_time: '2026-09-08T10:00:00Z',
      item: {
        item_id: 'item_brain',
        item_type: 'tool_call',
        tool_name: 'runtime-search_documents-1',
        input_data: { query: 'renewal deadline' },
        output_data: brain_search_output,
        output_text: JSON.stringify(brain_search_output.data),
      },
    };

    const wire = public_persisted_chat_event(event as never) as unknown as typeof event;
    const output = wire.item.output_data as unknown as Record<string, unknown>;

    expect(output.data).toEqual({ display: brain_search_output.data.display });
    expect(JSON.stringify(wire)).not.toContain('renewal deadline for the Milan venue');
    expect(wire.item.output_text).toBe('Searched Brain · 10 sources');
  });

  it('cuts every copy of the answer a stored tool_result message keeps', () => {
    const passages = JSON.stringify(brain_search_output.data);
    const result = { content_json: brain_search_output.data, content_text: passages };
    const part = {
      type: 'tool_result',
      tool_call_id: 'call_1',
      tool_name: 'runtime-search_documents-1',
      result,
    };
    const wire = public_session_message({
      run_message_id: 'msg_brain',
      workspace_id: 'wrk_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      message_role: 'tool_result',
      message_kind: 'message',
      message_content: {
        type: 'tool_result',
        text: passages,
        parts: [part],
        data: {
          tool_call_id: 'tcall_brain',
          model_tool_call_id: 'call_1',
          tool_name: 'runtime-search_documents-1',
          result,
          content: [part],
        },
      },
      content_text: null,
      content_json: null,
      provider_item_id: null,
      provider_call_id: null,
      token_count: null,
      metadata: {},
      tool_call_id: 'tcall_brain',
      is_user_visible: false,
      is_model_visible: true,
      source_type: 'api',
      source_metadata: {},
      message_sequence: 4,
      run_message_sequence: 4,
      created_time: new Date('2026-09-08T10:00:00Z'),
      created_by: 'test',
      last_updated_time: new Date('2026-09-08T10:00:00Z'),
      last_updated_by: 'test',
    }) as Record<string, unknown>;

    expect(JSON.stringify(wire)).not.toContain('renewal deadline for the Milan venue');
    const content = wire.message_content as {
      text: string;
      parts: { result: { data?: unknown } }[];
      data: { result: unknown; content: { result: unknown }[] };
    };
    expect(content.text).toBe('Searched Brain · 10 sources');
    const cut = { data: { display: brain_search_output.data.display } };
    expect(content.parts[0]?.result).toMatchObject({ content_json: cut });
    expect(content.data.result).toMatchObject({ content_json: cut });
    expect(content.data.content[0]?.result).toMatchObject({ content_json: cut });
  });

  it('cuts the answer on the live stream as well as on the replay', () => {
    const event = {
      event_id: 'evt_brain',
      sequence: 7,
      event_type: 'item_completed',
      run_id: 'run_1',
      occurred_time: '2026-09-08T10:00:00Z',
      item: {
        item_id: 'item_brain',
        item_type: 'tool_call',
        tool_name: 'runtime-search_documents-1',
        input_data: { query: 'renewal deadline' },
        output_data: brain_search_output,
        output_text: JSON.stringify(brain_search_output.data),
      },
    };

    const live = public_agent_run_stream_event({
      type: 'chat_event',
      event: event as never,
    } as never) as { event: typeof event };

    expect(JSON.stringify(live)).not.toContain('renewal deadline for the Milan venue');
    expect(live.event.item.output_text).toBe('Searched Brain · 10 sources');
  });

  it('cuts the answer on a chat_event run_event row', () => {
    const row = {
      run_event_id: 'revt_1',
      event_type: 'chat_event',
      event_label: 'item_completed',
      event_data: {
        event_type: 'item_completed',
        item: {
          item_id: 'item_brain',
          item_type: 'tool_call',
          tool_name: 'runtime-search_documents-1',
          output_data: brain_search_output,
          output_text: JSON.stringify(brain_search_output.data),
        },
      },
    };

    const wire = public_run_event(row);

    expect(JSON.stringify(wire)).not.toContain('renewal deadline for the Milan venue');
    expect(wire.event_data.item.output_text).toBe('Searched Brain · 10 sources');
  });

  it('keeps the display block of any oversized result, not only the brain', () => {
    const bounded = bounded_wire_value(
      {
        success: true,
        data: { rows: fat_text, display: { summary: 'Sent 3 emails', sources: [] } },
      },
      ['data', 'metadata'],
    ) as Record<string, unknown>;

    expect(bounded.wire_truncated).toBe(true);
    expect(bounded.data).toEqual({ display: { summary: 'Sent 3 emails', sources: [] } });
  });
});

function build_brain_search_output() {
  const documents = [
    { title: 'Venue Contract 2026', folder: 'Contracts', app_key: 'gdrive' },
    { title: 'Supplier Agreement 2026', folder: 'Contracts/Riders', app_key: 'gdrive' },
    {
      title: 'Chemistry Course CHEM7',
      folder: 'Training Courses/CHEM7 Chemistry',
      app_key: 'gdrive',
    },
    { title: '#sales — 2026-04-30', folder: '#sales', app_key: 'slack' },
    { title: '#sales — 2026-05-04', folder: '#sales', app_key: 'slack' },
    { title: 'Example Venue Deposit Schedule', folder: 'Contracts/Payments', app_key: 'gdrive' },
    { title: 'Supplier Agreement Addendum', folder: 'Contracts/Addenda', app_key: 'gdrive' },
    { title: '#operations — 2026-04-28', folder: '#operations', app_key: 'slack' },
    { title: 'Licensing Fee Notes 2026', folder: 'Finance/Licensing', app_key: 'gdrive' },
    { title: 'Q3_Leads.xlsx', folder: '#sales', app_key: 'slack' },
  ];
  const sources = documents.map((document, index) => ({
    brain_item_id: `itm_brain_document_${index + 1}`,
    title: document.title,
    app_key: document.app_key,
    location: `${document.folder}/${document.title}`,
    source_url:
      document.app_key === 'gdrive'
        ? `https://drive.google.com/file/d/drive_file_${index + 1}/view`
        : null,
    synced_at: '2026-09-01T09:12:44.000Z',
  }));
  const results = sources.map((source, index) => ({
    brain_item_id: source.brain_item_id,
    title: source.title,
    slug: `brain-document-${index + 1}`,
    app_key: source.app_key,
    item_kind: source.app_key === 'slack' ? 'slack_channel_day' : 'document',
    context:
      source.app_key === 'slack'
        ? `#sales · 2026-04-30 · part ${index + 1}/4`
        : `part ${index + 1}/12`,
    location: source.location,
    source_url: source.source_url,
    snippet:
      `The renewal deadline for the Milan venue is the fourth of October. ${'The supplier pays the licensing fee unless the rider says otherwise. '.repeat(11)}`.slice(
        0,
        700,
      ),
    snippet_truncated: true,
    synced_at: source.synced_at,
  }));
  const answer =
    'Found 10 passages matching "renewal deadline", best match first. Name a document by its title, and by the channel and day on its context line when it has them — never by its slug. For the full text, call runtime-read_document-1 with the slug exactly as returned.';

  return {
    success: true,
    data: {
      answer,
      results,
      result_count: 10,
      query: 'renewal deadline',
      sources,
      display: { summary: 'Searched Brain · 10 sources', sources },
    },
    model_visible_data: { answer, results, result_count: 10, query: 'renewal deadline' },
    metadata: { source: 'brain_document_search' },
  };
}

function build_brain_read_output() {
  const sources = [
    {
      brain_item_id: 'itm_venue_contract',
      title: 'Venue Contract 2026',
      app_key: 'gdrive',
      location: 'Contracts/Venue Contract 2026',
      source_url: 'https://drive.google.com/file/d/drive_file_1/view',
      synced_at: '2026-09-01T09:12:44.000Z',
      brain_item_revision_id: 'rev_venue_1',
    },
  ];
  const content_text =
    'The supplier pays the licensing fee unless the rider says otherwise. '.repeat(60);

  return {
    success: true,
    data: {
      brain_item_id: 'itm_venue_contract',
      title: 'Venue Contract 2026',
      slug: 'venue-contract-2026',
      app_key: 'gdrive',
      item_kind: 'document',
      location: 'Contracts/Venue Contract 2026',
      source_url: 'https://drive.google.com/file/d/drive_file_1/view',
      content_text,
      content_characters: content_text.length,
      content_truncated: false,
      part: 1,
      part_count: 1,
      synced_at: '2026-09-01T09:12:44.000Z',
      sources,
      display: { summary: 'Read Venue Contract 2026 from Brain', sources },
      links: [],
      backlinks: [],
    },
    metadata: { source: 'brain_document_read', resolved_by: 'slug' },
  };
}
