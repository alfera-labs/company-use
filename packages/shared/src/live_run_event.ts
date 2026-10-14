type LiveRunEventType = 'start' | 'progress' | 'message' | 'chat_event' | 'error' | 'end';

export type LiveRunEvent<EventPayload = unknown> = {
  run_event_id: string;
  run_id: string;
  session_id: string;
  event_sequence: number;
  event_type: LiveRunEventType;
  event_label: string | null;
  event_payload: EventPayload;
  created_time: string;
};

export type RunEventRow = {
  run_event_id: string;
  run_id: string;
  session_id: string;
  event_sequence: number;
  event_type: string;
  event_label: string | null;
  event_data: unknown;
  created_time: Date | string;
};

export function run_event_row_to_live_event(row: RunEventRow): LiveRunEvent {
  return {
    run_event_id: row.run_event_id,
    run_id: row.run_id,
    session_id: row.session_id,
    event_sequence: row.event_sequence,
    event_type: row.event_type as LiveRunEventType,
    event_label: row.event_label,
    event_payload: row.event_data,
    created_time: created_time_as_iso_string(row.created_time),
  };
}

function created_time_as_iso_string(created_time: Date | string) {
  return created_time instanceof Date
    ? created_time.toISOString()
    : new Date(created_time).toISOString();
}
