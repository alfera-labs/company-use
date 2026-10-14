import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_run_event,
  create_session,
  update_run_status,
} from '@coworker/core/db/queries/sessions';
import { run_events } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { describe, expect, it, vi } from 'vitest';

type SseFrame = {
  id?: string;
  event: string;
  data: unknown;
};

describe('run event stream routes', () => {
  it('does not expose a run from another workspace', async () => {
    const context = await create_run_event_stream_context();
    const headers = new Headers({
      Accept: 'text/event-stream',
      [proxy_auth_headers.secret]: 'local-development-internal-api-secret',
      [proxy_auth_headers.provider_key]: 'workos',
      [proxy_auth_headers.provider_user_id]: 'user_other_workspace',
      [proxy_auth_headers.organization_id]: 'org_other_workspace',
    });

    const response = await context.app.fetch(
      new Request(`http://localhost/v1/runs/${context.run.run_id}/events`, { headers }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'Run was not found' },
    });
  });

  it.each([
    ['negative query cursor', { cursor: '-1' }],
    ['fractional query cursor', { cursor: '1.5' }],
    ['non-numeric query cursor', { cursor: 'abc' }],
    ['negative Last-Event-ID', { last_event_id: '-1' }],
    ['fractional Last-Event-ID', { last_event_id: '1.5' }],
    ['non-numeric Last-Event-ID', { last_event_id: 'abc' }],
  ])('rejects an invalid %s', async (_case, cursor) => {
    const context = await create_run_event_stream_context();

    const response = await fetch_run_event_stream(context.app, context.run.run_id, cursor);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: 'validation_error',
        message: 'Run event cursor must be a non-negative integer',
      },
    });
  });

  it('streams pre-inserted run events in sequence order and closes after an end event', async () => {
    const context = await create_run_event_stream_context();
    await create_ordered_run_events(context);

    const response = await fetch_run_event_stream(context.app, context.run.run_id);
    const body = await response.text();
    const frames = parse_sse_frames(body);
    const run_event_frames = frames.filter((frame) => frame.event === 'run_event');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(run_event_frames.map((frame) => frame.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(run_event_frames.map((frame) => object_data(frame).event_sequence)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(run_event_frames.map((frame) => object_data(frame).event_type)).toEqual([
      'start',
      'progress',
      'chat_event',
      'message',
      'end',
    ]);
    expect(frames.at(-1)).toEqual({
      event: 'stream_end',
      data: { reason: 'end_event' },
    });
  });

  it('resumes after the cursor sequence', async () => {
    const context = await create_run_event_stream_context();
    await create_ordered_run_events(context);

    const response = await fetch_run_event_stream(context.app, context.run.run_id, { cursor: 3 });
    const body = await response.text();
    const run_event_frames = parse_sse_frames(body).filter((frame) => frame.event === 'run_event');

    expect(run_event_frames.map((frame) => frame.id)).toEqual(['4', '5']);
    expect(run_event_frames.map((frame) => object_data(frame).event_sequence)).toEqual([4, 5]);
  });

  it('resumes after the documented after_event_sequence parameter', async () => {
    const context = await create_run_event_stream_context();
    await create_ordered_run_events(context);

    const response = await fetch_run_event_stream(context.app, context.run.run_id, {
      after_event_sequence: 3,
    });
    const run_event_frames = parse_sse_frames(await response.text()).filter(
      (frame) => frame.event === 'run_event',
    );

    expect(response.status).toBe(200);
    expect(run_event_frames.map((frame) => frame.id)).toEqual(['4', '5']);
  });

  it('resumes from Last-Event-ID and gives it precedence over a stale query cursor', async () => {
    const context = await create_run_event_stream_context();
    await create_ordered_run_events(context);

    const response = await fetch_run_event_stream(context.app, context.run.run_id, {
      cursor: 1,
      last_event_id: 3,
    });
    const body = await response.text();
    const run_event_frames = parse_sse_frames(body).filter((frame) => frame.event === 'run_event');

    expect(response.status).toBe(200);
    expect(run_event_frames.map((frame) => frame.id)).toEqual(['4', '5']);
    expect(run_event_frames.map((frame) => object_data(frame).event_sequence)).toEqual([4, 5]);
  });

  it('replays multiple persistence pages without gaps or duplicate events', async () => {
    const context = await create_run_event_stream_context();
    const event_count = 205;
    await create_paginated_run_events(context, event_count);

    const response = await fetch_run_event_stream(context.app, context.run.run_id);
    const frames = parse_sse_frames(await response.text());
    const run_event_frames = frames.filter((frame) => frame.event === 'run_event');
    const expected_sequences = Array.from({ length: event_count }, (_, index) => index + 1);

    expect(response.status).toBe(200);
    expect(run_event_frames.map((frame) => Number(frame.id))).toEqual(expected_sequences);
    expect(run_event_frames.map((frame) => object_data(frame).event_sequence)).toEqual(
      expected_sequences,
    );
    expect(new Set(run_event_frames.map((frame) => frame.id)).size).toBe(event_count);
    expect(frames.at(-1)).toEqual({
      event: 'stream_end',
      data: { reason: 'end_event' },
    });
  });

  it('picks up a run event inserted after the request opens', async () => {
    const context = await create_run_event_stream_context();
    const response = await fetch_run_event_stream(context.app, context.run.run_id);
    const body_promise = response.text();

    await wait_for_stream_to_open();
    await create_run_event(context.db, {
      workspace_id: context.bootstrap.workspace_id,
      session_id: context.session.session_id,
      run_id: context.run.run_id,
      event_type: 'progress',
      event_label: 'worker.progress',
      event_data: { step: 'late' },
      actor_id: context.bootstrap.user_id,
    });
    await create_run_event(context.db, {
      workspace_id: context.bootstrap.workspace_id,
      session_id: context.session.session_id,
      run_id: context.run.run_id,
      event_type: 'end',
      event_label: 'worker.done',
      event_data: { ok: true },
      actor_id: context.bootstrap.user_id,
    });

    const body = await body_promise;
    const run_event_frames = parse_sse_frames(body).filter((frame) => frame.event === 'run_event');

    expect(run_event_frames.map((frame) => frame.id)).toEqual(['1', '2']);
    expect(object_data(run_event_frames[0]).event_payload).toEqual({ step: 'late' });
  });

  it('closes a terminal run that has no end event', async () => {
    const context = await create_run_event_stream_context();
    await create_run_event(context.db, {
      workspace_id: context.bootstrap.workspace_id,
      session_id: context.session.session_id,
      run_id: context.run.run_id,
      event_type: 'progress',
      event_label: 'worker.progress',
      event_data: { step: 'before_crash' },
      actor_id: context.bootstrap.user_id,
    });
    await update_run_status(context.db, {
      run_id: context.run.run_id,
      run_status: 'completed',
      actor_id: context.bootstrap.user_id,
    });

    const response = await fetch_run_event_stream(context.app, context.run.run_id);
    const body = await response.text();
    const frames = parse_sse_frames(body);

    expect(frames.at(-1)).toEqual({
      event: 'stream_end',
      data: { reason: 'run_terminal_without_end_event' },
    });
  });

  it('stops polling Postgres when the response reader is cancelled', async () => {
    const context = await create_run_event_stream_context();
    const list_events = vi.spyOn(context.db.query.run_events, 'findMany');
    const response = await fetch_run_event_stream(context.app, context.run.run_id);
    if (!response.body) throw new Error('Run event stream did not have a body.');
    const reader = response.body.getReader();
    await wait_for_first_event_query(list_events);

    await reader.cancel('browser disconnected');
    const query_count_after_cancel = list_events.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(list_events).toHaveBeenCalledTimes(query_count_after_cancel);
  });
});

async function wait_for_first_event_query(list_events: { mock: { calls: unknown[][] } }) {
  const deadline = Date.now() + 2_000;
  while (list_events.mock.calls.length === 0) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the first event query.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function create_run_event_stream_context() {
  const db = await create_test_database();
  const app = create_app(db);
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'Run event stream test',
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });

  return { app, db, bootstrap, session, run };
}

async function create_ordered_run_events(
  context: Awaited<ReturnType<typeof create_run_event_stream_context>>,
) {
  const event_types = ['start', 'progress', 'chat_event', 'message', 'end'] as const;

  for (const [index, event_type] of event_types.entries()) {
    const event_sequence = index + 1;
    await create_run_event(context.db, {
      workspace_id: context.bootstrap.workspace_id,
      session_id: context.session.session_id,
      run_id: context.run.run_id,
      event_type,
      event_label: `event.${event_type}`,
      event_data: { event_sequence, event_type },
      actor_id: context.bootstrap.user_id,
    });
  }
}

async function create_paginated_run_events(
  context: Awaited<ReturnType<typeof create_run_event_stream_context>>,
  event_count: number,
) {
  await context.db.insert(run_events).values(
    Array.from({ length: event_count }, (_, index) => {
      const event_sequence = index + 1;
      const event_type =
        event_sequence === 1 ? 'start' : event_sequence === event_count ? 'end' : 'progress';
      return {
        run_event_id: create_id(id_prefixes.run_event),
        workspace_id: context.bootstrap.workspace_id,
        session_id: context.session.session_id,
        run_id: context.run.run_id,
        event_sequence,
        event_type,
        event_label: `event.${event_type}`,
        event_data: { event_sequence, event_type },
        created_by: context.bootstrap.user_id,
        last_updated_by: context.bootstrap.user_id,
      };
    }),
  );
}

function fetch_run_event_stream(
  app: ReturnType<typeof create_app>,
  run_id: string,
  input: {
    after_event_sequence?: number | string;
    cursor?: number | string;
    last_event_id?: number | string;
  } = {},
) {
  const url = new URL(`http://localhost/v1/runs/${run_id}/events`);
  if (input.after_event_sequence !== undefined) {
    url.searchParams.set('after_event_sequence', String(input.after_event_sequence));
  }
  if (input.cursor !== undefined) url.searchParams.set('cursor', String(input.cursor));

  const headers = new Headers({ Accept: 'text/event-stream' });
  if (input.last_event_id !== undefined) {
    headers.set('Last-Event-ID', String(input.last_event_id));
  }

  return app.fetch(new Request(url, { headers }));
}

function parse_sse_frames(body: string) {
  return body
    .split('\n\n')
    .map((frame) => frame.trim())
    .filter((frame) => frame.length > 0 && !frame.startsWith(':'))
    .map(parse_sse_frame);
}

function parse_sse_frame(frame: string): SseFrame {
  const fields = frame.split('\n').reduce(
    (parsed, line) => {
      const separator_index = line.indexOf(':');
      if (separator_index === -1) return parsed;

      const name = line.slice(0, separator_index);
      const value = line.slice(separator_index + 1).trimStart();
      if (name === 'id') parsed.id = value;
      if (name === 'event') parsed.event = value;
      if (name === 'data') parsed.data_lines.push(value);
      return parsed;
    },
    { event: '', data_lines: [] as string[], id: undefined as string | undefined },
  );

  return {
    ...(fields.id === undefined ? {} : { id: fields.id }),
    event: fields.event,
    data: JSON.parse(fields.data_lines.join('\n')),
  };
}

function object_data(frame: SseFrame | undefined) {
  if (
    !frame ||
    typeof frame.data !== 'object' ||
    frame.data === null ||
    Array.isArray(frame.data)
  ) {
    throw new Error('Expected SSE frame data to be an object');
  }

  return frame.data as Record<string, unknown>;
}

function wait_for_stream_to_open() {
  return new Promise<void>((resolve) => setTimeout(resolve, 25));
}
