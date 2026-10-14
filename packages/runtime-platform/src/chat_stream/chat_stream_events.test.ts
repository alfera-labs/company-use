import type { RuntimeRunEvent } from '@agent-core/events/runtime_event';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { list_run_chat_events } from '@coworker/core/db/queries/sessions';
import {
  type ChatStreamEvent,
  type ChatStreamEventDraft,
  create_chat_stream_event_projector,
  project_runtime_event_to_chat_event_drafts,
  record_chat_stream_event_drafts,
  run_event_row_to_chat_stream_event,
  type ThinkingItem,
} from '@runtime-platform/chat_stream/chat_stream_events';
import { create_chat_stream_event_recorder } from '@runtime-platform/chat_stream/chat_stream_snapshots';
import { describe, expect, it } from 'vitest';

describe('chat stream events', () => {
  it('projects message deltas into assistant chat item deltas', () => {
    const drafts = project_runtime_event_to_chat_event_drafts({
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      event: {
        event_id: 'evt_1',
        event_sequence: 1,
        event_type: 'message_delta',
        run_key: 'run_1',
        delta: 'Checked ',
        accumulated_text: 'Checked ',
      },
    });

    expect(drafts).toEqual([
      expect.objectContaining({
        event_type: 'item_started',
        item: expect.objectContaining({ item_type: 'assistant_message' }),
      }),
      {
        event_type: 'item_delta',
        item_id: 'run_1:assistant:0',
        delta: { delta_type: 'text_delta', text: 'Checked ' },
        source: expect.objectContaining({ runtime_event_id: 'evt_1' }),
      },
    ]);
  });

  it('streams item deltas without persisting them as run events', async () => {
    const db = await create_test_database();
    const workspace_id = 'wsp_1';
    const session_id = 'ses_1';
    const run_id = 'run_1';
    const delta_drafts = project_runtime_event_to_chat_event_drafts({
      workspace_id,
      session_id,
      run_id,
      event: {
        event_id: 'evt_delta',
        event_sequence: 10,
        event_type: 'message_delta',
        run_key: run_id,
        delta: 'Checked ',
        accumulated_text: 'Checked ',
      },
    });
    const completed_drafts = project_runtime_event_to_chat_event_drafts({
      workspace_id,
      session_id,
      run_id,
      persisted_message_id: 'msg_1',
      event: {
        event_id: 'evt_message',
        event_sequence: 30,
        event_type: 'message',
        run_key: run_id,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Checked.' }],
        },
      },
    });

    const live_delta_events = await record_chat_stream_event_drafts(db, {
      workspace_id,
      session_id,
      run_id,
      drafts: delta_drafts,
      actor_id: 'test',
    });
    const live_completed_events = await record_chat_stream_event_drafts(db, {
      workspace_id,
      session_id,
      run_id,
      drafts: completed_drafts,
      actor_id: 'test',
    });

    const live_events = [...live_delta_events, ...live_completed_events];
    const persisted_events = await list_run_chat_events(db, workspace_id, run_id);

    expect(live_events.map((event) => event.event_type)).toEqual([
      'item_started',
      'item_delta',
      'item_completed',
    ]);
    expect(live_events.find((event) => event.event_type === 'item_delta')).toEqual(
      expect.objectContaining({
        event_id: expect.stringMatching(/^volatile_chat_event:/),
        sequence: 10,
      }),
    );
    expect(persisted_events.map((event) => event.event_label)).toEqual([
      'item_started',
      'item_completed',
    ]);
  });

  it('does not emit a duplicate assistant chat item completion after streamed text', () => {
    const projector = create_chat_stream_event_projector();
    const delta_drafts = projector({
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      event: {
        event_id: 'evt_delta',
        event_sequence: 10,
        event_type: 'message_delta',
        run_key: 'run_1',
        delta: 'Checked ',
        accumulated_text: 'Checked ',
      },
    });
    const message_drafts = projector({
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      persisted_message_id: 'msg_1',
      event: {
        event_id: 'evt_message',
        event_sequence: 11,
        event_type: 'message',
        run_key: 'run_1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Checked.' }],
        },
      },
    });

    expect(delta_drafts.map((draft) => draft.event_type)).toEqual(['item_started', 'item_delta']);
    expect(message_drafts).toEqual([]);
  });

  it('starts a new assistant chat item when text resumes after tools', () => {
    const projector = create_chat_stream_event_projector();
    const input_base = {
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
    };

    const first_text_drafts = projector({
      ...input_base,
      event: message_delta_event({
        event_id: 'evt_text_1',
        event_sequence: 10,
        delta: "I'll check Gmail.",
        accumulated_text: "I'll check Gmail.",
      }),
    });
    const tool_drafts = projector({
      ...input_base,
      event: progress_event({
        event_sequence: 20,
        label: 'pi.tool_execution_start',
        metadata: {
          tool_call_id: 'call_1',
          tool_name: 'gmail/find_email',
          args: { q: 'is:unread' },
        },
      }),
    });
    const second_text_drafts = projector({
      ...input_base,
      event: message_delta_event({
        event_id: 'evt_text_2',
        event_sequence: 30,
        delta: 'I found the thread.',
        accumulated_text: 'I found the thread.',
      }),
    });

    expect(first_text_drafts).toEqual([
      expect.objectContaining({
        event_type: 'item_started',
        item: expect.objectContaining({ item_id: 'run_1:assistant:0' }),
      }),
      expect.objectContaining({
        event_type: 'item_delta',
        item_id: 'run_1:assistant:0',
      }),
    ]);
    expect(tool_drafts).toEqual([
      expect.objectContaining({
        event_type: 'item_started',
        item: expect.objectContaining({
          item_type: 'tool_call',
          parent_item_id: 'run_1:assistant:0',
        }),
      }),
    ]);
    expect(second_text_drafts).toEqual([
      expect.objectContaining({
        event_type: 'item_started',
        item: expect.objectContaining({ item_id: 'run_1:assistant:1' }),
      }),
      expect.objectContaining({
        event_type: 'item_delta',
        item_id: 'run_1:assistant:1',
      }),
    ]);
  });

  it('projects a non-streamed assistant message after a streamed message finishes', () => {
    const projector = create_chat_stream_event_projector();
    const input_base = {
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
    };

    projector({
      ...input_base,
      event: message_delta_event({
        event_id: 'evt_text_1',
        event_sequence: 10,
        delta: 'Streaming.',
        accumulated_text: 'Streaming.',
      }),
    });
    const streamed_completion_drafts = projector({
      ...input_base,
      persisted_message_id: 'msg_streamed',
      event: message_event({
        event_id: 'evt_message_1',
        event_sequence: 11,
        text: 'Streaming.',
      }),
    });
    const non_streamed_message_drafts = projector({
      ...input_base,
      persisted_message_id: 'msg_non_streamed',
      event: message_event({
        event_id: 'evt_message_2',
        event_sequence: 20,
        text: 'Visible without deltas.',
      }),
    });

    expect(streamed_completion_drafts).toEqual([]);
    expect(non_streamed_message_drafts).toEqual([
      expect.objectContaining({
        event_type: 'item_completed',
        item: expect.objectContaining({
          item_id: 'run_1:assistant:1',
          message_id: 'msg_non_streamed',
          parts: [{ type: 'text', text: 'Visible without deltas.' }],
        }),
      }),
    ]);
  });

  it('links a tool call to the assistant message of its run', () => {
    const drafts = project_runtime_event_to_chat_event_drafts({
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      event: progress_event({
        label: 'pi.tool_execution_start',
        metadata: {
          tool_call_id: 'call_7',
          tool_name: 'gmail_search',
          args: { query: 'jordan' },
        },
      }),
    });

    expect(drafts).toEqual([
      {
        event_type: 'item_started',
        item: expect.objectContaining({
          item_type: 'tool_call',
          tool_call_id: 'call_7',
          parent_item_id: 'run_1:assistant:0',
        }),
        source: expect.objectContaining({ runtime_event_id: 'evt_progress' }),
      },
    ]);
  });

  it('consumes Pi thinking labels at the backend boundary', () => {
    const drafts = project_runtime_event_to_chat_event_drafts({
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      event: progress_event({
        label: 'pi.thinking_delta',
        delta: 'Inspecting.',
        content_index: 0,
      }),
    });

    expect(drafts).toEqual([
      {
        event_type: 'item_delta',
        item_id: 'run_1:thinking:0',
        delta: { delta_type: 'thinking_delta', text: 'Inspecting.' },
        source: expect.objectContaining({ runtime_event_id: 'evt_progress' }),
      },
    ]);
  });

  it('uses a new thinking item id for each reasoning burst', () => {
    const projector = create_chat_stream_event_projector();
    const input_base = {
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
    };

    const first_start = projector({
      ...input_base,
      event: progress_event({ event_sequence: 10, label: 'pi.thinking_start' }),
    });
    const first_delta = projector({
      ...input_base,
      event: progress_event({
        event_sequence: 11,
        label: 'pi.thinking_delta',
        delta: 'First.',
      }),
    });
    const first_end = projector({
      ...input_base,
      event: progress_event({
        event_sequence: 12,
        label: 'pi.thinking_end',
        metadata: { text: 'First.' },
      }),
    });
    const second_start = projector({
      ...input_base,
      event: progress_event({ event_sequence: 20, label: 'pi.thinking_start' }),
    });
    const second_delta = projector({
      ...input_base,
      event: progress_event({
        event_sequence: 21,
        label: 'pi.thinking_delta',
        delta: 'Second.',
      }),
    });

    expect(first_start).toEqual([
      expect.objectContaining({
        event_type: 'item_started',
        item: expect.objectContaining({ item_id: 'run_1:thinking:0' }),
      }),
    ]);
    expect(first_delta).toEqual([
      expect.objectContaining({ event_type: 'item_delta', item_id: 'run_1:thinking:0' }),
    ]);
    expect(first_end).toEqual([
      expect.objectContaining({
        event_type: 'item_completed',
        item: expect.objectContaining({ item_id: 'run_1:thinking:0' }),
      }),
    ]);
    expect(second_start).toEqual([
      expect.objectContaining({
        event_type: 'item_started',
        item: expect.objectContaining({ item_id: 'run_1:thinking:1' }),
      }),
    ]);
    expect(second_delta).toEqual([
      expect.objectContaining({ event_type: 'item_delta', item_id: 'run_1:thinking:1' }),
    ]);
  });

  it('projects generated UI progress labels at the backend boundary', () => {
    const ui_spec = {
      root: 'root',
      elements: {
        root: { type: 'Text', props: { text: 'Ready' }, children: [] },
      },
    };
    const drafts = project_runtime_event_to_chat_event_drafts({
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      event: progress_event({
        content_index: 3,
        label: 'pi.generative_ui_start',
        metadata: { renderer_key: 'json-render', ui_spec },
      }),
    });

    expect(drafts).toEqual([
      {
        event_type: 'item_started',
        item: expect.objectContaining({
          item_id: 'run_1:generative_ui:3',
          item_type: 'generative_ui',
          renderer_key: 'json-render',
          ui_spec,
          ui_spec_format: 'json-render',
        }),
        source: expect.objectContaining({ runtime_event_id: 'evt_progress' }),
      },
    ]);
  });

  it('projects generated UI deltas from progress metadata', () => {
    const ui_spec_delta = {
      elements: {
        root: { type: 'Text', props: { text: 'Still streaming' }, children: [] },
      },
    };
    const drafts = project_runtime_event_to_chat_event_drafts({
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      event: progress_event({
        content_index: 3,
        label: 'pi.generative_ui_delta',
        metadata: { ui_spec_delta },
      }),
    });

    expect(drafts).toEqual([
      {
        event_type: 'item_delta',
        item_id: 'run_1:generative_ui:3',
        delta: { delta_type: 'generative_ui_delta', ui_spec_delta },
        source: expect.objectContaining({ runtime_event_id: 'evt_progress' }),
      },
    ]);
  });

  it('projects data-id artifact metadata labels', () => {
    const drafts = project_runtime_event_to_chat_event_drafts({
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      event: progress_event({
        label: 'data-id',
        metadata: {
          data: 'artifact_1',
          kind: 'text',
          title: 'Silicon Valley Essay',
        },
      }),
    });

    expect(drafts).toEqual([
      {
        event_type: 'item_started',
        item: expect.objectContaining({
          file_id: 'artifact_1',
          file_purpose: 'text',
          item_id: 'run_1:artifact:artifact_1',
          item_type: 'artifact',
          title: 'Silicon Valley Essay',
        }),
        source: expect.objectContaining({ runtime_event_id: 'evt_progress' }),
      },
    ]);
  });

  it('projects data-textDelta artifact content deltas', () => {
    const drafts = project_runtime_event_to_chat_event_drafts({
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      event: progress_event({
        label: 'data-textDelta',
        metadata: {
          file_id: 'artifact_1',
          data: '# Silicon Valley\n\n',
        },
      }),
    });

    expect(drafts).toEqual([
      {
        event_type: 'item_delta',
        item_id: 'run_1:artifact:artifact_1',
        delta: {
          file_id: 'artifact_1',
          content_delta: '# Silicon Valley\n\n',
          delta_type: 'artifact_content_delta',
        },
        source: expect.objectContaining({ runtime_event_id: 'evt_progress' }),
      },
    ]);
  });

  it('links data-textDelta artifact deltas to the preceding data-id', () => {
    const project_chat_stream_event = create_chat_stream_event_projector();
    const input_base = {
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
    };

    const started_drafts = project_chat_stream_event({
      ...input_base,
      event: progress_event({
        content_index: 2,
        label: 'data-id',
        metadata: {
          data: 'artifact_1',
          kind: 'text',
          title: 'Silicon Valley Essay',
        },
      }),
    });
    const delta_drafts = project_chat_stream_event({
      ...input_base,
      event: progress_event({
        content_index: 2,
        label: 'data-textDelta',
        metadata: {
          data: '# Silicon Valley\n\n',
        },
      }),
    });
    const finished_drafts = project_chat_stream_event({
      ...input_base,
      event: progress_event({
        content_index: 2,
        label: 'data-finish',
        metadata: {
          kind: 'text',
          title: 'Silicon Valley Essay',
        },
      }),
    });

    expect(started_drafts).toEqual([
      expect.objectContaining({
        event_type: 'item_started',
        item: expect.objectContaining({
          file_id: 'artifact_1',
          item_id: 'run_1:artifact:artifact_1',
        }),
      }),
    ]);
    expect(delta_drafts).toEqual([
      {
        event_type: 'item_delta',
        item_id: 'run_1:artifact:artifact_1',
        delta: {
          file_id: 'artifact_1',
          content_delta: '# Silicon Valley\n\n',
          delta_type: 'artifact_content_delta',
        },
        source: expect.objectContaining({ runtime_event_id: 'evt_progress' }),
      },
    ]);
    expect(finished_drafts).toEqual([
      expect.objectContaining({
        event_type: 'item_completed',
        item: expect.objectContaining({
          file_id: 'artifact_1',
          item_id: 'run_1:artifact:artifact_1',
          item_status: 'complete',
        }),
      }),
    ]);
  });

  it('projects artifact finish labels', () => {
    const drafts = project_runtime_event_to_chat_event_drafts({
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      event: progress_event({
        label: 'data-finish',
        metadata: {
          file_id: 'artifact_1',
          kind: 'text',
          title: 'Silicon Valley Essay',
        },
      }),
    });

    expect(drafts).toEqual([
      {
        event_type: 'item_completed',
        item: expect.objectContaining({
          file_id: 'artifact_1',
          item_id: 'run_1:artifact:artifact_1',
          item_status: 'complete',
          item_type: 'artifact',
          title: 'Silicon Valley Essay',
        }),
        source: expect.objectContaining({ runtime_event_id: 'evt_progress' }),
      },
    ]);
  });
});

describe('in-flight chat stream snapshots', () => {
  const workspace_id = 'wsp_1';
  const session_id = 'ses_1';
  const run_id = 'run_1';
  const input_base = { workspace_id, session_id, run_id };

  it('persists one assistant snapshot per interval carrying the full accumulated text', async () => {
    const db = await create_test_database();
    const record_chat_stream_events = create_chat_stream_event_recorder(db, {
      ...input_base,
      actor_id: 'test',
    });
    const projector = create_chat_stream_event_projector();
    const streamed_text: [string, string, number][] = [
      ['Hel', 'Hel', 1_000],
      ['lo', 'Hello', 1_200],
      [' wor', 'Hello wor', 1_400],
      ['ld', 'Hello world', 1_600],
    ];

    for (const [delta, accumulated_text, now_ms] of streamed_text) {
      await record_chat_stream_events(
        projector({
          ...input_base,
          event: message_delta_event({
            event_id: `evt_${now_ms}`,
            event_sequence: now_ms,
            delta,
            accumulated_text,
          }),
        }),
        now_ms,
      );
    }

    const persisted_events = await replayed_chat_events(db);
    expect(persisted_events.map((event) => event.event_type)).toEqual([
      'item_started',
      'item_updated',
      'item_updated',
    ]);
    expect(snapshot_patches(persisted_events)).toEqual([
      {
        parts: [{ type: 'text', text: 'Hel' }],
        item_status: 'streaming',
        last_updated_time: new Date(1_000).toISOString(),
      },
      {
        parts: [{ type: 'text', text: 'Hello world' }],
        item_status: 'streaming',
        last_updated_time: new Date(1_600).toISOString(),
      },
    ]);
  });

  it('snapshots thinking items on their own interval', async () => {
    const db = await create_test_database();
    const record_chat_stream_events = create_chat_stream_event_recorder(db, {
      ...input_base,
      actor_id: 'test',
    });

    await record_chat_stream_events([delta_draft('item_assistant', 'text_delta', 'A1')], 1_000);
    await record_chat_stream_events([delta_draft('item_thinking', 'thinking_delta', 'T1')], 1_100);
    await record_chat_stream_events([delta_draft('item_assistant', 'text_delta', 'A2')], 1_300);
    await record_chat_stream_events([delta_draft('item_thinking', 'thinking_delta', 'T2')], 1_700);
    await record_chat_stream_events([delta_draft('item_assistant', 'text_delta', 'A3')], 1_700);

    const persisted_events = await replayed_chat_events(db);
    expect(persisted_events.map((event) => [event.event_type, item_id_of(event)])).toEqual([
      ['item_updated', 'item_assistant'],
      ['item_updated', 'item_thinking'],
      ['item_updated', 'item_thinking'],
      ['item_updated', 'item_assistant'],
    ]);
    expect(snapshot_patches(persisted_events).map(snapshot_text)).toEqual([
      'A1',
      'T1',
      'T1T2',
      'A1A2A3',
    ]);
  });

  it('stops snapshotting an item once it completed', async () => {
    const db = await create_test_database();
    const record_chat_stream_events = create_chat_stream_event_recorder(db, {
      ...input_base,
      actor_id: 'test',
    });

    await record_chat_stream_events([delta_draft('item_thinking', 'thinking_delta', 'T1')], 1_000);
    await record_chat_stream_events([thinking_completed_draft('item_thinking', 'T1')], 1_100);
    await record_chat_stream_events(
      [delta_draft('item_thinking', 'thinking_delta', 'late')],
      9_000,
    );

    const persisted_events = await replayed_chat_events(db);
    expect(persisted_events.map((event) => event.event_type)).toEqual([
      'item_updated',
      'item_completed',
    ]);
    expect(snapshot_patches(persisted_events).map(snapshot_text)).toEqual(['T1']);
  });

  it('reconstructs the streamed text from persisted events alone', async () => {
    const db = await create_test_database();
    const record_chat_stream_events = create_chat_stream_event_recorder(db, {
      ...input_base,
      actor_id: 'test',
    });
    const projector = create_chat_stream_event_projector();
    const record_progress_event = async (
      event: Parameters<typeof progress_event>[0],
      now_ms: number,
    ) =>
      record_chat_stream_events(projector({ ...input_base, event: progress_event(event) }), now_ms);

    await record_progress_event({ event_sequence: 10, label: 'pi.thinking_start' }, 1_000);
    await record_progress_event(
      { event_sequence: 11, label: 'pi.thinking_delta', delta: 'Check' },
      1_000,
    );
    await record_progress_event(
      { event_sequence: 12, label: 'pi.thinking_delta', delta: 'ing the' },
      1_200,
    );
    await record_progress_event(
      { event_sequence: 13, label: 'pi.thinking_delta', delta: ' inbox.' },
      1_600,
    );
    await record_progress_event(
      { event_sequence: 14, label: 'pi.thinking_end', content: 'Checking the inbox.' },
      1_700,
    );

    const persisted_events = await replayed_chat_events(db);
    expect(persisted_events.map((event) => event.event_type)).toEqual([
      'item_started',
      'item_updated',
      'item_updated',
      'item_completed',
    ]);
    expect(replayed_thinking_texts(persisted_events)).toEqual([
      '',
      'Check',
      'Checking the inbox.',
      'Checking the inbox.',
    ]);
  });

  it('flushes a final complete snapshot before run_completed for still-streaming items', async () => {
    const db = await create_test_database();
    const record_chat_stream_events = create_chat_stream_event_recorder(db, {
      ...input_base,
      actor_id: 'test',
    });

    await record_chat_stream_events([delta_draft('item_assistant', 'text_delta', 'Hel')], 1_000);
    await record_chat_stream_events([delta_draft('item_assistant', 'text_delta', 'lo')], 1_100);
    await record_chat_stream_events([run_completed_draft()], 1_200);

    const persisted_events = await replayed_chat_events(db);
    expect(persisted_events.map((event) => event.event_type)).toEqual([
      'item_updated',
      'item_updated',
      'run_completed',
    ]);
    expect(snapshot_patches(persisted_events).at(-1)).toEqual({
      parts: [{ type: 'text', text: 'Hello' }],
      item_status: 'complete',
      last_updated_time: new Date(1_200).toISOString(),
    });
  });

  it('saves the whole sentence when a tool starts before the next interval', async () => {
    const db = await create_test_database();
    const record_chat_stream_events = create_chat_stream_event_recorder(db, {
      ...input_base,
      actor_id: 'test',
    });

    await record_chat_stream_events(
      [delta_draft('item_assistant', 'text_delta', 'Now cre')],
      1_000,
    );
    await record_chat_stream_events(
      [delta_draft('item_assistant', 'text_delta', 'ating the spreadsheet.')],
      1_100,
    );
    await record_chat_stream_events([tool_started_draft('item_tool')], 1_200);
    await record_chat_stream_events([tool_started_draft('item_tool_2')], 1_300);

    const persisted_events = await replayed_chat_events(db);
    expect(persisted_events.map((event) => [event.event_type, item_id_of(event)])).toEqual([
      ['item_updated', 'item_assistant'],
      ['item_updated', 'item_assistant'],
      ['item_started', 'item_tool'],
      ['item_started', 'item_tool_2'],
    ]);
    expect(snapshot_patches(persisted_events).map(snapshot_text)).toEqual([
      'Now cre',
      'Now creating the spreadsheet.',
    ]);
  });

  it('does not flush items that already completed when the run completes', async () => {
    const db = await create_test_database();
    const record_chat_stream_events = create_chat_stream_event_recorder(db, {
      ...input_base,
      actor_id: 'test',
    });

    await record_chat_stream_events([delta_draft('item_thinking', 'thinking_delta', 'T1')], 1_000);
    await record_chat_stream_events([thinking_completed_draft('item_thinking', 'T1')], 1_100);
    await record_chat_stream_events([run_completed_draft()], 1_200);

    const persisted_events = await replayed_chat_events(db);
    expect(persisted_events.map((event) => event.event_type)).toEqual([
      'item_updated',
      'item_completed',
      'run_completed',
    ]);
  });

  async function replayed_chat_events(db: Awaited<ReturnType<typeof create_test_database>>) {
    const rows = await list_run_chat_events(db, workspace_id, run_id);
    return rows.map((row) => run_event_row_to_chat_stream_event(row));
  }
});

function delta_draft(
  item_id: string,
  delta_type: 'text_delta' | 'thinking_delta',
  text: string,
): ChatStreamEventDraft {
  return {
    event_type: 'item_delta',
    item_id,
    delta: { delta_type, text },
    source: { source_type: 'runtime_event', runtime_event_id: 'evt_delta' },
  };
}

function run_completed_draft(): ChatStreamEventDraft {
  return {
    event_type: 'run_completed',
    run_status: 'completed',
    source: { source_type: 'runtime_event', runtime_event_id: 'evt_end' },
  };
}

function tool_started_draft(item_id: string): ChatStreamEventDraft {
  return {
    event_type: 'item_started',
    item: {
      item_id,
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      item_type: 'tool_call',
      item_status: 'streaming',
      item_sequence: 2,
      created_time: new Date(0).toISOString(),
      last_updated_time: new Date(0).toISOString(),
      tool_call_id: `call_${item_id}`,
      tool_name: 'workspace-list_files-1',
      tool_kind: 'file',
      tool_status: 'running',
      file_ids: [],
    },
    source: { source_type: 'runtime_event', runtime_event_id: `evt_${item_id}` },
  };
}

function thinking_completed_draft(item_id: string, text: string): ChatStreamEventDraft {
  return {
    event_type: 'item_completed',
    item: {
      item_id,
      workspace_id: 'wsp_1',
      session_id: 'ses_1',
      run_id: 'run_1',
      item_type: 'thinking',
      item_status: 'complete',
      item_sequence: 1,
      created_time: new Date(0).toISOString(),
      last_updated_time: new Date(0).toISOString(),
      text,
      is_collapsed_by_default: true,
    },
    source: { source_type: 'runtime_event', runtime_event_id: 'evt_thinking_end' },
  };
}

function snapshot_patches(events: ChatStreamEvent[]) {
  return events.flatMap((event) => (event.event_type === 'item_updated' ? [event.patch] : []));
}

function snapshot_text(patch: unknown) {
  const record = patch as { text?: string; parts?: { text?: string }[] };
  return record.text ?? record.parts?.[0]?.text ?? '';
}

function item_id_of(event: ChatStreamEvent) {
  if ('item_id' in event) return event.item_id;
  return 'item' in event ? event.item.item_id : undefined;
}

function replayed_thinking_texts(events: ChatStreamEvent[]) {
  let text = '';
  return events.map((event) => {
    if (event.event_type === 'item_started' || event.event_type === 'item_completed') {
      text = (event.item as ThinkingItem).text;
    }
    if (event.event_type === 'item_updated') {
      text = (event.patch as Partial<ThinkingItem>).text ?? text;
    }
    return text;
  });
}

function progress_event(input: {
  label: string;
  delta?: string;
  content?: string;
  content_index?: number;
  event_sequence?: number;
  metadata?: Record<string, unknown>;
}): RuntimeRunEvent {
  return {
    event_id: 'evt_progress',
    event_sequence: input.event_sequence ?? 2,
    event_type: 'progress',
    run_key: 'run_1',
    label: input.label,
    ...(input.content === undefined ? {} : { content: input.content }),
    ...(input.delta === undefined ? {} : { delta: input.delta }),
    ...(input.content_index === undefined ? {} : { content_index: input.content_index }),
    metadata: { provider: 'openai', model: 'gpt-test', ...(input.metadata ?? {}) },
  };
}

function message_delta_event(input: {
  accumulated_text: string;
  delta: string;
  event_id: string;
  event_sequence: number;
}): RuntimeRunEvent {
  return {
    event_id: input.event_id,
    event_sequence: input.event_sequence,
    event_type: 'message_delta',
    run_key: 'run_1',
    delta: input.delta,
    accumulated_text: input.accumulated_text,
  };
}

function message_event(input: {
  event_id: string;
  event_sequence: number;
  text: string;
}): RuntimeRunEvent {
  return {
    event_id: input.event_id,
    event_sequence: input.event_sequence,
    event_type: 'message',
    run_key: 'run_1',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: input.text }],
    },
  };
}
