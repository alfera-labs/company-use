import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_query } from '@api/lib/validate';
import { public_session_message_match } from '@api/routes/sessions/public_session_message_match';
import {
  search_session_messages,
  session_message_search_max_limit,
} from '@coworker/core/db/queries/session_message_search';
import { Hono } from 'hono';
import { z } from 'zod';

const query_text_max_length = 200;

const session_search_query_schema = z.object({
  q: z.string().max(query_text_max_length),
  limit: z.coerce.number().int().positive().max(session_message_search_max_limit).optional(),
});

export const session_search_routes = new Hono<ApiEnv>().get(
  '/v1/sessions/search',
  validate_query(session_search_query_schema),
  async (c) => {
    const query = c.req.valid('query');
    const matches = await search_session_messages(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      user_id: c.get('user_id'),
      query_text: query.q,
      conversation_text_only: true,
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });

    return c.json(ok(matches.map(public_session_message_match)));
  },
);
