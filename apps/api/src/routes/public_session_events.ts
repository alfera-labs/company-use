import { key_authed_route } from '@api/lib/api_key_auth';
import { open_long_poll_slot } from '@api/lib/api_key_long_poll';
import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { require_route_param } from '@api/lib/route_params';
import { parse_json_body, parse_query } from '@api/lib/validate';
import { assert_alfera_api_tool_allowed } from '@api/services/policies/alfera_api_tool_gate';
import {
  type PublicSessionEventType,
  public_session_event_types,
} from '@api/services/sessions_api/public_session_events';
import {
  assert_session_event_cursor,
  read_session_events,
} from '@api/services/sessions_api/session_event_reads';
import { create_session_event_stream } from '@api/services/sessions_api/session_event_stream';
import {
  type SendableSessionEvent,
  send_api_session_events,
} from '@api/services/sessions_api/session_event_writes';
import { require_owned_api_session } from '@api/services/sessions_api/session_reads';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { ValidationError } from '@coworker/shared';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

export const text_block_schema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1).max(8000),
});

const max_text_blocks_per_message = 20;
const max_events_per_request = 20;

export const max_text_blocks_per_turn = max_text_blocks_per_message * max_events_per_request;
export const turn_text_blocks_schema = z
  .array(text_block_schema)
  .min(1)
  .max(max_text_blocks_per_turn);

export const tool_confirmation_event_schema = z.strictObject({
  type: z.literal('user.tool_confirmation'),
  tool_use_id: z.string().min(1).max(200),
  result: z.enum(['allow', 'deny']),
  deny_message: z.string().min(1).max(2000).optional(),
});

const sendable_event_schema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('user.message'),
    content: z.array(text_block_schema).min(1).max(max_text_blocks_per_message),
  }),
  z.strictObject({ type: z.literal('user.interrupt') }),
  tool_confirmation_event_schema,
]);

export const send_events_body_schema = z.strictObject({
  events: z.array(sendable_event_schema).min(1).max(max_events_per_request),
});

const list_events_query_schema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  page: z.string().min(1).optional(),
});

const sse_headers = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

export const public_session_event_routes = new Hono<ApiEnv>()
  .post('/v1/sessions/:session_id/events', key_authed_route('sessions.write', send_events))
  .get('/v1/sessions/:session_id/events/stream', key_authed_route('sessions.read', stream_events))
  .get('/v1/sessions/:session_id/events', key_authed_route('sessions.read', list_events));

async function send_events(c: Context<ApiEnv>, api_key: ApiKey) {
  const body = await parse_json_body(c, send_events_body_schema);
  for (const tool_name of governed_tools_of(body.events)) {
    await assert_alfera_api_tool_allowed(c.get('db'), api_key, tool_name);
  }
  const accepted = await send_api_session_events(
    c.get('db'),
    api_key,
    require_route_param(c, 'session_id'),
    body.events as SendableSessionEvent[],
  );
  return c.json(ok(accepted), 202);
}

const governed_tool_by_event_type: Partial<Record<SendableSessionEvent['type'], string>> = {
  'user.message': 'send_message',
  'user.tool_confirmation': 'confirm_tool',
};

function governed_tools_of(events: ReadonlyArray<{ type: SendableSessionEvent['type'] }>) {
  return new Set(events.flatMap((event) => governed_tool_by_event_type[event.type] ?? []));
}

async function list_events(c: Context<ApiEnv>, api_key: ApiKey) {
  const query = parse_query(c, list_events_query_schema);
  const db = c.get('db');
  const session = await require_owned_api_session(
    db,
    api_key,
    require_route_param(c, 'session_id'),
  );
  const page = await read_session_events(db, {
    workspace_id: api_key.workspace_id,
    session,
    after_event_id: query.page,
    limit: query.limit,
    types: read_requested_types(c),
  });
  return c.json({
    ...ok(page.data),
    next_page: page.has_more ? (page.data.at(-1)?.id ?? null) : null,
    prev_page: null,
  });
}

async function stream_events(c: Context<ApiEnv>, api_key: ApiKey) {
  const db = c.get('db');
  const session_id = require_route_param(c, 'session_id');
  const session = await require_owned_api_session(db, api_key, session_id);
  const after_event_id = read_stream_cursor(c);
  if (after_event_id) {
    await assert_session_event_cursor(db, api_key.workspace_id, session, after_event_id);
  }
  const release_slot = open_long_poll_slot(api_key.api_key_id);

  return c.body(
    create_session_event_stream({
      db,
      api_key,
      session_id,
      after_event_id,
      signal: c.req.raw.signal,
      on_close: release_slot,
    }),
    200,
    sse_headers,
  );
}

function read_stream_cursor(c: Context<ApiEnv>) {
  return c.req.header('last-event-id')?.trim() || c.req.query('cursor')?.trim() || undefined;
}

function read_requested_types(c: Context<ApiEnv>): PublicSessionEventType[] | undefined {
  const requested = [...(c.req.queries('types[]') ?? []), ...(c.req.queries('types') ?? [])];
  if (requested.length === 0) return undefined;
  const known = new Set<string>(public_session_event_types);
  const unknown = requested.filter((type) => !known.has(type));
  if (unknown.length > 0) {
    throw new ValidationError(`No such event type: ${unknown.join(', ')}`, { unknown });
  }
  return requested as PublicSessionEventType[];
}
