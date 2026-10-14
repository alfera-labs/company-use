import { apps, connections, type Database, nodes } from '@coworker/core';
import { create_logger, scout_actor } from '@coworker/shared';
import { execute_catalog_tool } from '@runtime-platform/tools/catalog_tool_execution';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

const log = create_logger('scout_calendar');

export type ScoutCalendarEvent = {
  when: string;
  ends: string | null;
  title: string;
  app_name: string;
  event_id: string | null;
  event: Record<string, unknown>;
};

type CalendarReader = {
  node_names: readonly string[];
  build_input: (from: Date, to: Date, limit: number) => Record<string, unknown>;
};

const google_calendar_reader: CalendarReader = {
  node_names: ['find_event', 'list_events', 'events_list', 'get_events'],
  build_input: (from, to, limit) => ({
    calendarId: 'primary',
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: true,
    max_results: limit,
  }),
};

const outlook_calendar_reader: CalendarReader = {
  node_names: ['list_events', 'get_calendar_view', 'find_event'],
  build_input: (from, to, limit) => ({
    startDateTime: from.toISOString(),
    endDateTime: to.toISOString(),
    top: limit,
  }),
};

const calendar_readers: Record<string, CalendarReader> = {
  googlecalendar: google_calendar_reader,
  google_calendar: google_calendar_reader,
  outlook: outlook_calendar_reader,
  outlook_calendar: outlook_calendar_reader,
  microsoft_outlook: outlook_calendar_reader,
};

export type RunCatalogTool = typeof execute_catalog_tool;

export async function list_upcoming_calendar_events(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    now?: Date | undefined;
    days?: number | undefined;
    limit?: number | undefined;
    run_catalog_tool?: RunCatalogTool | undefined;
  },
): Promise<ScoutCalendarEvent[] | null> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 20;
  const calendar = await find_connected_calendar_node(db, input.workspace_id);
  if (!calendar) return [];

  const to = new Date(now.getTime() + (input.days ?? 7) * 24 * 60 * 60 * 1_000);
  const run_catalog_tool = input.run_catalog_tool ?? execute_catalog_tool;
  const result = await run_catalog_tool(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: `scout_calendar:${now.toISOString()}`,
    actor_id: scout_actor,
    node_key: calendar.node_key,
    connection_id: calendar.connection_id,
    tool_input: calendar.reader.build_input(now, to, limit),
    room_private_to: null,
  });
  if (!result.success) {
    log.warn('the scout could not read the calendar', {
      workspace_id: input.workspace_id,
      node_key: calendar.node_key,
      error_code: result.error.code,
      error_message: result.error.message,
    });
    return null;
  }
  return read_calendar_events(result.data, calendar.app_name).slice(0, limit);
}

export async function find_connected_calendar_node(db: Database, workspace_id: string) {
  const rows = await db
    .select({
      connection_id: connections.connection_id,
      app_id: connections.app_id,
      app_name: apps.app_name,
      app_metadata: apps.metadata,
    })
    .from(connections)
    .innerJoin(apps, eq(apps.app_id, connections.app_id))
    .where(
      and(eq(connections.workspace_id, workspace_id), eq(connections.connection_status, 'active')),
    );
  for (const { app_metadata, ...row } of rows) {
    const reader =
      calendar_readers[row.app_name] ?? calendar_readers[read_toolkit_slug(app_metadata)];
    if (!reader) continue;
    const node = await find_list_events_node(db, row.app_id, reader);
    if (node) {
      return { ...row, reader, node_key: node.node_key };
    }
  }
  return null;
}

function read_toolkit_slug(metadata: Record<string, unknown>) {
  const sourced_from = metadata.sourced_from;
  const slug =
    sourced_from && typeof sourced_from === 'object'
      ? (sourced_from as Record<string, unknown>).provider_app_slug
      : null;
  return typeof slug === 'string' ? slug : '';
}

async function find_list_events_node(db: Database, app_id: string, reader: CalendarReader) {
  const rows = await db
    .select({ node_key: nodes.node_key, node_name: nodes.node_name })
    .from(nodes)
    .where(and(eq(nodes.app_id, app_id), inArray(nodes.node_name, [...reader.node_names])));
  for (const node_name of reader.node_names) {
    const match = rows.find((row) => row.node_name === node_name);
    if (match) return match;
  }
  return null;
}

// Every provider names the start and the title differently, so the schema lists the names rather
// than branching on the provider. A name a provider invents gets a line here.
// Field-name matching, not per-provider parsers.
const trimmed_text = z.string().trim().min(1).optional().catch(undefined);

const start_texts_schema = z
  .object({
    dateTime: trimmed_text,
    date: trimmed_text,
    start_time: trimmed_text,
    startTime: trimmed_text,
    start: trimmed_text,
  })
  .catch({})
  .transform(
    (start) => start.dateTime ?? start.date ?? start.start_time ?? start.startTime ?? start.start,
  );

const end_texts_schema = z
  .object({
    dateTime: trimmed_text,
    date: trimmed_text,
    end_time: trimmed_text,
    endTime: trimmed_text,
    end: trimmed_text,
  })
  .catch({})
  .transform((end) => end.dateTime ?? end.date ?? end.end_time ?? end.endTime ?? end.end);

const event_texts_schema = z
  .object({
    summary: trimmed_text,
    subject: trimmed_text,
    title: trimmed_text,
    name: trimmed_text,
    id: trimmed_text,
    event_id: trimmed_text,
    iCalUID: trimmed_text,
    uid: trimmed_text,
  })
  .catch({});

// Every provider wraps its list differently ({ items }, { events }, { data: { value } }). Take the
// first array of objects in the answer and read each one against the schemas above.
function read_calendar_events(data: unknown, app_name: string): ScoutCalendarEvent[] {
  const list = find_first_object_array(data, 3);
  return list.flatMap((item) => {
    const when = start_texts_schema.parse(item.start) ?? start_texts_schema.parse(item);
    const ends = end_texts_schema.parse(item.end) ?? end_texts_schema.parse(item);
    const event = event_texts_schema.parse(item);
    const title = event.summary ?? event.subject ?? event.title ?? event.name;
    if (!when || !title) return [];
    return [
      {
        when: when.slice(0, 40),
        ends: ends ? ends.slice(0, 40) : null,
        title: title.slice(0, 160),
        app_name,
        event_id: event.id ?? event.event_id ?? event.iCalUID ?? event.uid ?? null,
        event: item,
      },
    ];
  });
}

function find_first_object_array(value: unknown, depth: number): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
    );
  }
  if (depth <= 0 || !value || typeof value !== 'object') return [];
  for (const nested of Object.values(value as Record<string, unknown>)) {
    const found = find_first_object_array(nested, depth - 1);
    if (found.length > 0) return found;
  }
  return [];
}
