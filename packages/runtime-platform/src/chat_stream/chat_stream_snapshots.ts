import type { Database } from '@coworker/core';
import {
  type AssistantMessageItem,
  type ChatItemDelta,
  type ChatStreamEventDraft,
  record_chat_stream_event_drafts,
  type ThinkingItem,
} from '@runtime-platform/chat_stream/chat_stream_events';

const time_between_persisted_snapshots_ms = 500;

type SnapshotItemType = 'assistant_message' | 'thinking';

type ItemSnapshotState = {
  item_type?: SnapshotItemType;
  accumulated_text: string;
  last_snapshot_time_ms?: number;
  snapshot_text_length?: number;
  is_completed?: boolean;
};

/**
 * Per-run coalescer. Give it the drafts for one runtime event and the current time; it
 * returns the same drafts with in-flight snapshots inserted after the deltas that earned
 * one. Time is a parameter so callers own the clock and tests need no timers.
 */
export function create_chat_stream_snapshot_coalescer() {
  const state_by_item_id = new Map<string, ItemSnapshotState>();

  return function add_in_flight_snapshot_drafts(
    drafts: ChatStreamEventDraft[],
    now_ms: number,
  ): ChatStreamEventDraft[] {
    return drafts.flatMap((draft) => {
      if (draft.event_type === 'run_completed') {
        return [...final_snapshot_drafts(state_by_item_id, now_ms), draft];
      }
      if (draft.event_type === 'item_started') {
        return [...unsaved_text_drafts(state_by_item_id, draft.item.item_id, now_ms), draft];
      }
      return [draft, ...snapshot_drafts_for(state_by_item_id, draft, now_ms)];
    });
  };
}

/** Records a run's chat events, snapshotting streaming items as they go. */
export function create_chat_stream_event_recorder(
  db: Database,
  ids: { workspace_id: string; session_id: string; run_id: string; actor_id: string },
) {
  const add_in_flight_snapshot_drafts = create_chat_stream_snapshot_coalescer();

  return (drafts: ChatStreamEventDraft[], now_ms: number = Date.now()) =>
    record_chat_stream_event_drafts(db, {
      ...ids,
      drafts: add_in_flight_snapshot_drafts(drafts, now_ms),
    });
}

function snapshot_drafts_for(
  state_by_item_id: Map<string, ItemSnapshotState>,
  draft: ChatStreamEventDraft,
  now_ms: number,
): ChatStreamEventDraft[] {
  if (draft.event_type === 'item_completed') {
    state_by_item_id.set(draft.item.item_id, { accumulated_text: '', is_completed: true });
    return [];
  }

  if (draft.event_type === 'item_failed') {
    state_by_item_id.set(draft.item_id, { accumulated_text: '', is_completed: true });
    return [];
  }

  if (draft.event_type !== 'item_delta') return [];

  const item_type = snapshot_item_type_for_delta(draft.delta);
  if (!item_type) return [];

  const state = state_by_item_id.get(draft.item_id) ?? { accumulated_text: '' };
  if (state.is_completed) return [];

  state.item_type = item_type;
  state.accumulated_text += delta_text(draft.delta);
  state_by_item_id.set(draft.item_id, state);
  if (!is_snapshot_due(state.last_snapshot_time_ms, now_ms)) return [];

  return [streaming_snapshot_draft(draft.item_id, item_type, state, now_ms, draft.source)];
}

function unsaved_text_drafts(
  state_by_item_id: Map<string, ItemSnapshotState>,
  started_item_id: string,
  now_ms: number,
): ChatStreamEventDraft[] {
  const drafts: ChatStreamEventDraft[] = [];
  for (const [item_id, state] of state_by_item_id) {
    if (item_id === started_item_id || state.is_completed || !state.item_type) continue;
    if (state.accumulated_text.length === state.snapshot_text_length) continue;
    drafts.push(
      streaming_snapshot_draft(item_id, state.item_type, state, now_ms, { source_type: 'system' }),
    );
  }
  return drafts;
}

function streaming_snapshot_draft(
  item_id: string,
  item_type: SnapshotItemType,
  state: ItemSnapshotState,
  now_ms: number,
  source: ChatStreamEventDraft['source'],
): ChatStreamEventDraft {
  state.last_snapshot_time_ms = now_ms;
  state.snapshot_text_length = state.accumulated_text.length;
  return {
    event_type: 'item_updated',
    item_id,
    patch: snapshot_patch(item_type, state.accumulated_text, now_ms, 'streaming'),
    source,
  };
}

function final_snapshot_drafts(
  state_by_item_id: Map<string, ItemSnapshotState>,
  now_ms: number,
): ChatStreamEventDraft[] {
  const drafts: ChatStreamEventDraft[] = [];
  for (const [item_id, state] of state_by_item_id) {
    if (state.is_completed || !state.item_type || !state.accumulated_text) continue;
    state.is_completed = true;
    drafts.push({
      event_type: 'item_updated',
      item_id,
      patch: snapshot_patch(state.item_type, state.accumulated_text, now_ms, 'complete'),
      source: { source_type: 'system' },
    });
  }
  return drafts;
}

function is_snapshot_due(last_snapshot_time_ms: number | undefined, now_ms: number) {
  if (last_snapshot_time_ms === undefined) return true;
  return now_ms - last_snapshot_time_ms >= time_between_persisted_snapshots_ms;
}

function snapshot_patch(
  item_type: SnapshotItemType,
  accumulated_text: string,
  now_ms: number,
  item_status: 'streaming' | 'complete',
): Partial<AssistantMessageItem> | Partial<ThinkingItem> {
  const last_updated_time = new Date(now_ms).toISOString();
  if (item_type === 'thinking') {
    return { text: accumulated_text, item_status, last_updated_time };
  }

  return {
    parts: [{ type: 'text', text: accumulated_text }],
    item_status,
    last_updated_time,
  };
}

function snapshot_item_type_for_delta(delta: ChatItemDelta): SnapshotItemType | undefined {
  if (delta.delta_type === 'text_delta') return 'assistant_message';
  if (delta.delta_type === 'thinking_delta') return 'thinking';
  return undefined;
}

function delta_text(delta: ChatItemDelta) {
  return 'text' in delta ? delta.text : '';
}
