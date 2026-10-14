import node_definition from '@connectors/apps/granola/read_notes/v1/node.json' with {
  type: 'json',
};
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

const note_schema = node_definition.response_schema as JsonSchema;

type GranolaPerson = { name?: string | null; email?: string | null };

type GranolaCalendarEvent = {
  event_title?: string | null;
  organiser?: string | null;
  calendar_event_id?: string | null;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  invitees?: { email?: string | null }[] | null;
};

type GranolaNote = {
  id: string;
  title?: string | null;
  owner?: GranolaPerson | null;
  created_at: string;
  updated_at: string;
  web_url?: string | null;
  summary_text?: string | null;
  summary_markdown?: string | null;
  private_notes_text?: string | null;
  private_notes_markdown?: string | null;
  attendees?: GranolaPerson[] | null;
  folder_membership?:
    | { id: string; name?: string | null; parent_folder_id?: string | null }[]
    | null;
  calendar_event?: GranolaCalendarEvent | null;
};

export type ReadNotesInput = { note_ids: string[] };

function to_person(person: GranolaPerson) {
  return { name: person.name ?? null, email: person.email ?? null };
}

function to_calendar_event(event: GranolaCalendarEvent | null | undefined) {
  if (!event) return null;
  return {
    event_title: event.event_title ?? null,
    organiser_email: event.organiser ?? null,
    calendar_event_id: event.calendar_event_id ?? null,
    scheduled_start_time: event.scheduled_start_time ?? null,
    scheduled_end_time: event.scheduled_end_time ?? null,
    invitee_emails: (event.invitees ?? [])
      .map((invitee) => invitee.email)
      .filter((email): email is string => typeof email === 'string'),
  };
}

function to_note_output(note: GranolaNote) {
  return {
    id: note.id,
    title: note.title ?? null,
    owner: to_person(note.owner ?? {}),
    created_at: note.created_at,
    updated_at: note.updated_at,
    web_url: note.web_url ?? null,
    summary_text: note.summary_text ?? null,
    summary_markdown: note.summary_markdown ?? null,
    private_notes_text: note.private_notes_text ?? null,
    private_notes_markdown: note.private_notes_markdown ?? null,
    attendees: (note.attendees ?? []).map(to_person),
    folders: (note.folder_membership ?? []).map((folder) => ({
      id: folder.id,
      name: folder.name ?? null,
      parent_folder_id: folder.parent_folder_id ?? null,
    })),
    calendar_event: to_calendar_event(note.calendar_event),
  };
}

export async function execute(input: ReadNotesInput, context: ConnectorNodeContext) {
  const results = await context.fan_out({
    items: input.note_ids,
    limits: context.app.rate_limits,
    call_one: (note_id: string) =>
      context.send_request<GranolaNote>({
        method: 'GET',
        path: `/v1/notes/${encodeURIComponent(note_id)}`,
        response_schema: note_schema,
      }),
  });

  const notes: ReturnType<typeof to_note_output>[] = [];
  const errors = [];
  for (const result of results) {
    if (result.ok) {
      notes.push(to_note_output(result.data));
      continue;
    }
    errors.push({
      note_id: input.note_ids[result.index] as string,
      code: result.error.code,
      message: result.error.message,
      retryable: result.error.retryable,
    });
  }
  return { notes, errors };
}
