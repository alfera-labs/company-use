import { beforeEach, describe, expect, it } from 'vitest';
import { useChatLiveStreamStore } from '@/components/app/chat_live_stream_store';
import { chat_thread_streaming_text } from '@/components/app/chat_stream_projection';
import type { ChatStreamEvent } from '@/lib/api';

describe('chat live stream store', () => {
  beforeEach(() => {
    useChatLiveStreamStore.setState({
      live_thread_by_session: {},
      persisted_cursor_by_run: {},
      selected_artifact_id_by_session: {},
    });
  });

  it('merges replayed snapshots without dropping live deltas', () => {
    const session_id = 'ses_1';
    const started_event = assistant_item_started_event();
    const delta_event = assistant_item_delta_event();

    useChatLiveStreamStore.getState().apply_chat_stream_event(session_id, started_event);
    useChatLiveStreamStore.getState().apply_chat_stream_event(session_id, delta_event);
    useChatLiveStreamStore.getState().merge_replayed_chat_events(session_id, [started_event]);

    const projection = useChatLiveStreamStore.getState().live_thread_by_session[session_id];
    expect(chat_thread_streaming_text(projection)).toBe('Streaming text.');
  });

  it('never advances the replay cursor from a live volatile delta', () => {
    const session_id = 'ses_1';
    const volatile_delta = {
      ...assistant_item_delta_event(),
      sequence: 910_000,
    } as ChatStreamEvent;

    useChatLiveStreamStore
      .getState()
      .merge_replayed_chat_events(session_id, [assistant_item_started_event()]);
    useChatLiveStreamStore.getState().apply_chat_stream_event(session_id, volatile_delta);

    const state = useChatLiveStreamStore.getState();
    expect(state.persisted_cursor_by_run.run_1).toBe(1);
    expect(state.live_thread_by_session[session_id]?.last_sequence).toBe(910_000);
  });

  it('keeps a replay cursor per run, so a later run replays from its own first event', () => {
    const session_id = 'ses_1';
    useChatLiveStreamStore
      .getState()
      .merge_replayed_chat_events(session_id, [
        { ...assistant_item_started_event(), sequence: 40 } as ChatStreamEvent,
      ]);
    useChatLiveStreamStore.getState().merge_replayed_chat_events(session_id, [
      {
        ...assistant_item_started_event(),
        event_id: 'evt_run_2',
        run_id: 'run_2',
        sequence: 1,
      } as ChatStreamEvent,
    ]);

    const state = useChatLiveStreamStore.getState();
    expect(state.persisted_cursor_by_run.run_1).toBe(40);
    expect(state.persisted_cursor_by_run.run_2).toBe(1);
  });

  it('advances the replay cursor past rows the live stream already showed', () => {
    const session_id = 'ses_1';
    const started_event = assistant_item_started_event();

    useChatLiveStreamStore.getState().apply_chat_stream_event(session_id, started_event);
    useChatLiveStreamStore.getState().merge_replayed_chat_events(session_id, [started_event]);

    expect(useChatLiveStreamStore.getState().persisted_cursor_by_run.run_1).toBe(1);
  });

  it('drops the replay cursor with the thread it belongs to', () => {
    const session_id = 'ses_1';
    useChatLiveStreamStore
      .getState()
      .merge_replayed_chat_events(session_id, [assistant_item_started_event()]);
    useChatLiveStreamStore.getState().clear_live_thread(session_id);

    expect(useChatLiveStreamStore.getState().persisted_cursor_by_run.run_1).toBeUndefined();
  });
});

function assistant_item_started_event() {
  return {
    ...base_chat_event('evt_started', 'item_started', 1),
    item: {
      item_id: 'run_1:assistant:0',
      run_id: 'run_1',
      item_type: 'assistant_message',
      item_status: 'streaming',
      item_sequence: 1,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
      created_time: '2026-06-16T00:00:00.000Z',
      last_updated_time: '2026-06-16T00:00:00.000Z',
    },
  } as ChatStreamEvent;
}

function assistant_item_delta_event() {
  return {
    ...base_chat_event('volatile_chat_event:run_1:evt_delta:item_delta:0', 'item_delta', 2),
    item_id: 'run_1:assistant:0',
    delta: { delta_type: 'text_delta', text: 'Streaming text.' },
  } as ChatStreamEvent;
}

function base_chat_event(event_id: string, event_type: string, sequence: number) {
  return {
    event_id,
    workspace_id: 'wsp_1',
    session_id: 'ses_1',
    run_id: 'run_1',
    sequence,
    event_type,
    occurred_time: '2026-06-16T00:00:00.000Z',
    source: { source_type: 'runtime_event', runtime_event_id: event_id },
  };
}
