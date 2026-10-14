import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_query } from '@api/lib/validate';
import {
  append_notification_follow_up,
  find_notification,
  list_notifications_page,
} from '@coworker/core/db/queries/notification_outcomes';
import {
  type notification_follow_ups,
  notification_outcomes,
} from '@coworker/core/db/schema/automation_contracts';
import { NotFoundError } from '@coworker/shared';
import { keep_notifications_person_reads } from '@runtime-platform/tools/notification_readers';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const list_notifications_query_schema = z
  .object({
    open: z.enum(['true', 'false']).transform((value) => value === 'true'),
    outcome: z.union([
      z.enum(notification_outcomes).transform((one) => [one]),
      z.array(z.enum(notification_outcomes)),
    ]),
    automation_id: z.string().min(1),
    days: z.coerce.number().int().min(1).max(365),
    q: z.string().min(1).max(200),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(25),
  })
  .partial({ open: true, outcome: true, automation_id: true, days: true, q: true })
  .strict();

const ending_follow_ups = {
  dismiss: 'dismissed',
  act: 'acted',
} as const satisfies Record<string, (typeof notification_follow_ups)[number]>;

export const notification_routes = new Hono<ApiEnv>()
  .get('/v1/notifications', validate_query(list_notifications_query_schema), async (c) => {
    const query = c.req.valid('query');
    const page = await list_notifications_page(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      automation_id: query.automation_id,
      outcomes: query.outcome,
      only_open: query.open,
      days: query.days,
      search_text: query.q,
      page: query.page,
      page_size: query.page_size,
    });
    const items = await keep_notifications_person_reads(c.get('db'), reader_of(c), page.items);
    return c.json(ok({ ...page, items }));
  })
  .post('/v1/notifications/:notification_event_id/dismiss', async (c) => {
    return c.json(ok(await end_notification(c, c.req.param('notification_event_id'), 'dismiss')));
  })
  .post('/v1/notifications/:notification_event_id/act', async (c) => {
    return c.json(ok(await end_notification(c, c.req.param('notification_event_id'), 'act')));
  });

function reader_of(c: Context<ApiEnv>) {
  return { workspace_id: c.get('workspace_id'), user_id: c.get('user_id') };
}

async function end_notification(
  c: Context<ApiEnv>,
  notification_event_id: string,
  ending: keyof typeof ending_follow_ups,
) {
  const workspace_id = c.get('workspace_id');
  const outcome = await find_notification(c.get('db'), {
    workspace_id,
    event_id: notification_event_id,
  });
  const readable = outcome
    ? await keep_notifications_person_reads(c.get('db'), reader_of(c), [outcome])
    : [];
  if (!outcome || readable.length === 0) throw new NotFoundError('Notification');
  await append_notification_follow_up(c.get('db'), {
    workspace_id,
    fingerprint: outcome.fingerprint,
    subject: outcome.queue_key,
    follow_up: ending_follow_ups[ending],
    outcome_event_id: outcome.event_id,
    actor_id: c.get('user_id'),
  });
  return { ...outcome, is_open: false };
}
