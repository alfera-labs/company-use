import {
  public_session_usage,
  session_is_archived,
} from '@api/services/sessions_api/public_session';
import {
  decode_session_event_id,
  type PublicSessionEvent,
  type PublicSessionEventType,
  project_session_run_event,
  public_user_message_event,
  type SessionEventPosition,
  type SessionEventRun,
  session_terminated_event,
  user_message_event_sequence,
} from '@api/services/sessions_api/public_session_events';
import { list_restored_run_events } from '@api/services/sessions_api/stored_run_event_batch';
import type { runs, sessions } from '@coworker/core';
import type { Database } from '@coworker/core/db/connection';
import { list_run_messages, list_session_runs } from '@coworker/core/db/queries/sessions';
import { ValidationError } from '@coworker/shared';

type SessionRow = typeof sessions.$inferSelect;
type RunRow = typeof runs.$inferSelect;

const stored_row_batch_size = 200;

export type ReadSessionEventsRequest = {
  workspace_id: string;
  session: SessionRow;
  after_event_id?: string | undefined;
  limit: number;
  types?: readonly PublicSessionEventType[] | undefined;
};

export type SessionEventPage = { data: PublicSessionEvent[]; has_more: boolean };

type TimelinePosition = SessionEventPosition & { run_index: number };

export async function read_session_events(
  db: Database,
  request: ReadSessionEventsRequest,
): Promise<SessionEventPage> {
  const runs_oldest_first = await read_session_runs(db, request.workspace_id, request.session);
  const after = read_cursor_position(request.after_event_id, runs_oldest_first);
  const collector = create_event_collector(request, after);

  for (let run_index = after?.run_index ?? 0; run_index < runs_oldest_first.length; run_index++) {
    const run = runs_oldest_first[run_index];
    if (!run || collector.is_full()) break;
    await collect_run_events(db, request.workspace_id, {
      run,
      run_index,
      after,
      collector,
    });
  }

  if (session_is_archived(request.session)) {
    collector.take(session_terminated_event(request.session.last_updated_time), {
      run_index: runs_oldest_first.length,
    });
  }
  return collector.page();
}

export async function assert_session_event_cursor(
  db: Database,
  workspace_id: string,
  session: SessionRow,
  after_event_id: string,
): Promise<void> {
  read_cursor_position(after_event_id, await read_session_runs(db, workspace_id, session));
}

const last_message_scan_size = 100;

export async function read_last_agent_message(
  db: Database,
  workspace_id: string,
  session: SessionRow,
): Promise<string | null> {
  let cursor: string | undefined;
  let last: PublicSessionEvent | undefined;
  // Pages to the end rather than reading backwards. The filter drops everything but
  // assistant text, so one pass covers any session a caller has patience for.
  for (;;) {
    const page = await read_session_events(db, {
      workspace_id,
      session,
      after_event_id: cursor,
      limit: last_message_scan_size,
      types: ['agent.message'],
    });
    const newest = page.data.at(-1);
    if (newest) last = newest;
    if (!page.has_more || !newest) break;
    cursor = newest.id;
  }
  if (last?.type !== 'agent.message') return null;
  const text = last.content.map((block) => block.text).join('');
  return text || null;
}

type EventCollector = ReturnType<typeof create_event_collector>;

function create_event_collector(request: ReadSessionEventsRequest, after: TimelinePosition | null) {
  const wanted = request.types ? new Set<string>(request.types) : null;
  const collected: PublicSessionEvent[] = [];
  return {
    take(event: PublicSessionEvent, at: { run_index: number }) {
      const position = { ...decode_session_event_id(event.id), run_index: at.run_index };
      if (after && !is_after(position, after)) return;
      if (wanted && !wanted.has(event.type)) return;
      collected.push(event);
    },
    is_full: () => collected.length > request.limit,
    page: (): SessionEventPage => ({
      data: collected.slice(0, request.limit),
      has_more: collected.length > request.limit,
    }),
  };
}

async function collect_run_events(
  db: Database,
  workspace_id: string,
  input: {
    run: RunRow;
    run_index: number;
    after: TimelinePosition | null;
    collector: EventCollector;
  },
) {
  const { run, run_index, collector } = input;
  const resume_from =
    input.after && input.after.run_index === run_index ? input.after.event_sequence : -1;

  if (resume_from < user_message_event_sequence) {
    for (const event of await read_run_user_messages(db, workspace_id, run.run_id)) {
      collector.take(event, { run_index });
    }
  }

  let event_sequence = Math.max(resume_from - 1, 0);
  for (;;) {
    const rows = await list_restored_run_events(db, workspace_id, run.run_id, {
      after_sequence: event_sequence,
      limit: stored_row_batch_size,
    });
    for (const row of rows) {
      event_sequence = row.event_sequence;
      for (const event of project_session_run_event(row, public_run_facts(run))) {
        collector.take(event, { run_index });
      }
    }
    if (rows.length < stored_row_batch_size || collector.is_full()) break;
  }
}

function public_run_facts(run: RunRow): SessionEventRun {
  return {
    run_id: run.run_id,
    error_code: run.error_code,
    usage: public_session_usage(run),
  };
}

async function read_run_user_messages(
  db: Database,
  workspace_id: string,
  run_id: string,
): Promise<PublicSessionEvent[]> {
  const messages = await list_run_messages(db, workspace_id, run_id);
  return messages
    .filter((message) => message.message_role === 'user')
    .map((message) => ({ message, content: read_message_text_blocks(message.message_content) }))
    .filter((turn) => turn.content.length > 0)
    .map((turn, slot) =>
      public_user_message_event({
        run_id,
        slot,
        created_time: turn.message.created_time,
        content: turn.content,
      }),
    );
}

function read_message_text_blocks(content: unknown) {
  const message = (content ?? {}) as {
    text?: unknown;
    parts?: { type?: string; text?: unknown }[];
  };
  const parts = (message.parts ?? []).flatMap((part) =>
    part.type === 'text' && typeof part.text === 'string' && part.text
      ? [{ type: 'text' as const, text: part.text }]
      : [],
  );
  if (parts.length > 0) return parts;
  return typeof message.text === 'string' && message.text
    ? [{ type: 'text' as const, text: message.text }]
    : [];
}

async function read_session_runs(db: Database, workspace_id: string, session: SessionRow) {
  const session_runs = await list_session_runs(db, workspace_id, session.session_id);
  return session_runs.reverse();
}

function read_cursor_position(
  after_event_id: string | undefined,
  runs_oldest_first: RunRow[],
): TimelinePosition | null {
  if (!after_event_id) return null;
  const position = decode_session_event_id(after_event_id);
  if (position.run_id === '') return { ...position, run_index: runs_oldest_first.length };
  const run_index = runs_oldest_first.findIndex((run) => run.run_id === position.run_id);
  if (run_index < 0) throw new ValidationError('That event id belongs to a different session');
  return { ...position, run_index };
}

function is_after(position: TimelinePosition, after: TimelinePosition) {
  if (position.run_index !== after.run_index) return position.run_index > after.run_index;
  if (position.event_sequence !== after.event_sequence) {
    return position.event_sequence > after.event_sequence;
  }
  return position.slot > after.slot;
}
