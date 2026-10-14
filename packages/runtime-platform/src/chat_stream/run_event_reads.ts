import type { Database } from '@coworker/core';
import { restore_chat_event_tool_outputs } from '@runtime-platform/chat_stream/stored_chat_event_reads';
import {
  type RunEventPayloadReading,
  restore_run_event_payloads,
} from '@runtime-platform/orchestrator/stored_run_event_payloads';
import { restore_runtime_tool_events } from '@runtime-platform/orchestrator/stored_runtime_tool_events';

type RunEventRow = {
  run_id: string;
  event_type: string;
  event_data: unknown;
  event_metadata?: unknown;
  metadata?: unknown;
};

export async function read_run_events<T extends RunEventRow>(
  db: Database,
  input: { workspace_id: string; rows: T[]; payload_reading: RunEventPayloadReading },
): Promise<T[]> {
  const payloads = await restore_run_event_payloads(db, {
    workspace_id: input.workspace_id,
    rows: input.rows,
    reading: input.payload_reading,
  });
  const chat_events = await restore_chat_event_tool_outputs(db, {
    workspace_id: input.workspace_id,
    rows: payloads,
    reading: 'use_preview',
  });
  return restore_runtime_tool_events(db, { workspace_id: input.workspace_id, rows: chat_events });
}
