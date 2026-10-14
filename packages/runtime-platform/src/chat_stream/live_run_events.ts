import type { Database } from '@coworker/core';
import { list_run_chat_event_page } from '@coworker/core/db/queries/session_read_pages';
import { get_run } from '@coworker/core/db/queries/sessions';
import type { LiveEventPublisher } from '@coworker/jobs';
import { NotFoundError } from '@coworker/shared';
import { run_event_row_to_chat_stream_event } from '@runtime-platform/chat_stream/chat_stream_events';
import {
  public_agent_run_stream_event,
  public_chat_stream_event,
} from '@runtime-platform/chat_stream/public_run_output';
import { public_session_message } from '@runtime-platform/chat_stream/public_session_reads';
import { read_run_events } from '@runtime-platform/chat_stream/run_event_reads';
import type { AgentRunStreamEvent } from '@runtime-platform/orchestrator/runtime_orchestrator';

export function publish_live_run_event(
  live_events: LiveEventPublisher,
  event: AgentRunStreamEvent,
) {
  if (event.type === 'runtime_event') return;
  const projected =
    event.type === 'message_created'
      ? { ...event, message: public_session_message(event.message) }
      : public_agent_run_stream_event(event);
  live_events.publish(JSON.parse(JSON.stringify(projected)) as unknown);
}

export async function list_public_run_chat_events(
  db: Database,
  input: { workspace_id: string; run_id: string; after_sequence?: number; limit?: number },
) {
  const rows = await list_run_chat_event_page(db, input);
  const events = await read_run_events(db, {
    workspace_id: input.workspace_id,
    rows,
    payload_reading: 'load_full_value',
  });
  return events.map(run_event_row_to_chat_stream_event).map(public_chat_stream_event);
}

export async function list_session_run_chat_events_after(
  db: Database,
  input: { workspace_id: string; session_id: string; run_id: string; after_sequence: number },
) {
  const run = await get_run(db, input.workspace_id, input.run_id);
  if (!run || run.session_id !== input.session_id) throw new NotFoundError('Run');
  return list_public_run_chat_events(db, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    after_sequence: input.after_sequence,
  });
}
