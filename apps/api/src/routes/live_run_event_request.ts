import { ValidationError } from '@coworker/shared';

export function request_wants_live_run_events(request: Request) {
  const accept = request.headers.get('accept') ?? '';
  const url = new URL(request.url);
  return (
    accept.includes('text/event-stream') ||
    request.headers.has('last-event-id') ||
    url.searchParams.has('after_event_sequence') ||
    url.searchParams.has('cursor')
  );
}

export function read_stream_cursor(
  request: Request,
  after_event_sequence: string | undefined,
  cursor_alias: string | undefined,
) {
  const cursor = request.headers.get('last-event-id') ?? after_event_sequence ?? cursor_alias;
  if (cursor === undefined || cursor.trim() === '') return 0;

  const event_sequence = Number(cursor);
  if (!Number.isInteger(event_sequence) || event_sequence < 0) {
    throw new ValidationError('Run event cursor must be a non-negative integer');
  }

  return event_sequence;
}
