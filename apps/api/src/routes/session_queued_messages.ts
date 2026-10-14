import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { require_session_reader } from '@api/routes/sessions/session_reader';
import {
  list_queued_session_messages,
  remove_queued_session_message,
  resume_paused_session_messages,
  send_session_message,
} from '@api/services/sessions/session_message_queue';
import {
  repeat_queued_message_schema,
  repeat_session_message,
} from '@api/services/sessions/session_message_repeat';
import { create_queued_message_schema } from '@api/services/sessions/session_message_request';
import { ValidationError } from '@coworker/shared';
import { zValidator } from '@hono/zod-validator';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const validate_queued_message = zValidator('json', create_queued_message_schema, (result) => {
  if (result.success) return;
  throw new ValidationError('Request body failed validation', z.flattenError(result.error));
});

const validate_repeated_message = zValidator('json', repeat_queued_message_schema, (result) => {
  if (result.success) return;
  throw new ValidationError('Request body failed validation', z.flattenError(result.error));
});

export const session_queued_message_routes = new Hono<ApiEnv>()
  .use('/v1/sessions/:session_id/queued-messages', require_session_reader)
  .use('/v1/sessions/:session_id/queued-messages/*', require_session_reader)
  .post('/v1/sessions/:session_id/queued-messages', validate_queued_message, async (c) => {
    const { client_message_id, ...body } = c.req.valid('json');
    const scope = read_scope(c);
    const sent = await send_session_message(c.get('db'), { ...scope, client_message_id, body });
    return c.json(
      ok({
        job_id: sent.job.job_id,
        session_id: scope.session_id,
        waiting_reason: sent.waiting_reason,
      }),
      sent.created ? 202 : 200,
    );
  })
  .post('/v1/sessions/:session_id/queued-messages/repeat', validate_repeated_message, async (c) => {
    const scope = read_scope(c);
    const sent = await repeat_session_message(c.get('db'), { ...scope, ...c.req.valid('json') });
    return c.json(
      ok({
        job_id: sent.job.job_id,
        session_id: scope.session_id,
        waiting_reason: sent.waiting_reason,
      }),
      sent.created ? 202 : 200,
    );
  })
  .get('/v1/sessions/:session_id/queued-messages', async (c) => {
    return c.json(ok(await list_queued_session_messages(c.get('db'), read_scope(c))));
  })
  .post('/v1/sessions/:session_id/queued-messages/resume', async (c) => {
    return c.json(ok(await resume_paused_session_messages(c.get('db'), read_scope(c))));
  })
  .delete('/v1/sessions/:session_id/queued-messages/:job_id', async (c) => {
    const removed = await remove_queued_session_message(c.get('db'), {
      ...read_scope(c),
      job_id: c.req.param('job_id'),
    });
    return c.json(ok({ job_id: removed.job_id, removed: true }));
  });

function read_scope(c: Context<ApiEnv>) {
  return {
    workspace_id: c.get('workspace_id'),
    session_id: c.req.param('session_id') ?? '',
    user_id: c.get('user_id'),
  };
}
