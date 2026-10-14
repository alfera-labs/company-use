import { key_authed_route } from '@api/lib/api_key_auth';
import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { require_route_param } from '@api/lib/route_params';
import { parse_json_body, parse_query } from '@api/lib/validate';
import { key_authed_tool_route } from '@api/services/policies/alfera_api_tool_gate';
import { share_with_its_readers_schema } from '@api/services/sessions/chat_move_that_shares';
import { archive_api_session } from '@api/services/sessions_api/session_archive';
import { decode_page_cursor } from '@api/services/sessions_api/session_page_cursor';
import { move_api_session } from '@api/services/sessions_api/session_placement';
import { get_api_session, list_api_sessions } from '@api/services/sessions_api/session_reads';
import { create_api_session } from '@api/services/sessions_api/session_service';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { ValidationError } from '@coworker/shared';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const text_block_schema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1).max(8000),
});

const initial_event_schema = z.strictObject({
  type: z.literal('user.message'),
  content: z.array(text_block_schema).min(1).max(20),
});

const metadata_schema = z
  .record(z.string().min(1).max(128), z.string().max(1000))
  .refine((metadata) => Object.keys(metadata).length <= 16, 'metadata takes at most 16 keys');

export const create_session_body_schema = z.strictObject({
  agent: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(200).optional(),
  initial_events: z.array(initial_event_schema).max(20).default([]),
  metadata: metadata_schema.default({}),
});

// Where the session is filed. Null takes it out of every project. Renaming is not here: the
// dashboard has no rename either, only the first-turn title the agent writes itself.
export const move_session_body_schema = z.strictObject({
  project_id: z.string().min(1).max(200).nullable(),
  share_with_its_readers: share_with_its_readers_schema,
});

const list_sessions_query_schema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(['asc', 'desc']).default('desc'),
  agent: z.string().min(1).max(200).optional(),
  page: z.string().min(1).optional(),
});

export const public_session_routes = new Hono<ApiEnv>()
  .post('/v1/sessions', key_authed_tool_route('sessions.write', 'create_session', create_session))
  .get('/v1/sessions', key_authed_route('sessions.read', list_sessions))
  .post(
    '/v1/sessions/:session_id/archive',
    key_authed_tool_route('sessions.write', 'archive_session', archive_session),
  )
  .get('/v1/sessions/:session_id', key_authed_route('sessions.read', read_session))
  .patch(
    '/v1/sessions/:session_id',
    key_authed_tool_route('sessions.write', 'move_session', move_session),
  );

async function create_session(c: Context<ApiEnv>, api_key: ApiKey) {
  const body = await parse_json_body(c, create_session_body_schema);
  const session = await create_api_session(
    c.get('db'),
    {
      api_key,
      agent_slug: body.agent,
      title: body.title,
      initial_events: body.initial_events,
      metadata: body.metadata,
    },
    c.req.header('idempotency-key')?.trim() || undefined,
  );
  return c.json(ok(session), 201);
}

async function read_session(c: Context<ApiEnv>, api_key: ApiKey) {
  const session = await get_api_session(c.get('db'), api_key, require_route_param(c, 'session_id'));
  return c.json(ok(session));
}

async function move_session(c: Context<ApiEnv>, api_key: ApiKey) {
  const body = await parse_json_body(c, move_session_body_schema);
  const moved = await move_api_session(c.get('db'), api_key, {
    session_id: require_route_param(c, 'session_id'),
    project_id: body.project_id,
    share_with_its_readers: body.share_with_its_readers,
  });
  return c.json(ok(moved));
}

async function archive_session(c: Context<ApiEnv>, api_key: ApiKey) {
  const session = await archive_api_session(
    c.get('db'),
    api_key,
    require_route_param(c, 'session_id'),
  );
  return c.json(ok(session));
}

async function list_sessions(c: Context<ApiEnv>, api_key: ApiKey) {
  const query = parse_query(c, list_sessions_query_schema);
  const cursor = query.page ? decode_page_cursor(query.page) : undefined;
  if (cursor && c.req.query('order') && cursor.order !== query.order) {
    throw new ValidationError('This page cursor belongs to a different order');
  }
  const page = await list_api_sessions(c.get('db'), api_key, {
    limit: query.limit,
    order: cursor?.order ?? query.order,
    agent_slug: query.agent,
    cursor,
  });
  return c.json({ ...ok(page.data), next_page: page.next_page, prev_page: page.prev_page });
}
