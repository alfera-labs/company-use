import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { require_session_reader } from '@api/routes/sessions/session_reader';
import { issue_session_stream_ticket } from '@api/services/sessions/session_stream_ticket';
import { Hono } from 'hono';

export const session_stream_ticket_routes = new Hono<ApiEnv>()
  .use('/v1/sessions/:session_id/stream-ticket', require_session_reader)
  .post('/v1/sessions/:session_id/stream-ticket', async (c) =>
    c.json(
      ok(
        await issue_session_stream_ticket({
          workspace_id: c.get('workspace_id'),
          session_id: c.req.param('session_id'),
          user_id: c.get('user_id'),
        }),
      ),
    ),
  );
