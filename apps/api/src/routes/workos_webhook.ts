import type { ApiEnv } from '@api/lib/context';
import { error_body, ok } from '@api/lib/response';
import { construct_workos_event, membership_event_types } from '@api/lib/workos_webhooks';
import { sync_organization_membership } from '@api/services/workspace';
import { env } from '@coworker/config';
import { Hono } from 'hono';

export const workos_webhook_routes = new Hono<ApiEnv>().post('/v1/webhooks/workos', async (c) => {
  const secret = env.WORKOS_WEBHOOK_SECRET;
  const signature = c.req.header('workos-signature');
  if (!secret || !signature) {
    return c.json(error_body('bad_request', 'WorkOS webhook is not configured'), 400);
  }

  const payload = await c.req.text();
  let event: Awaited<ReturnType<typeof construct_workos_event>>;
  try {
    event = await construct_workos_event({ payload, signature, secret });
  } catch {
    return c.json(error_body('bad_request', 'Invalid WorkOS webhook signature'), 400);
  }

  if (membership_event_types.has(event.event) && event.data.userId && event.data.organizationId) {
    await sync_organization_membership(c.get('db'), {
      action: event.event === 'organization_membership.deleted' ? 'deactivate' : 'upsert',
      provider_user_id: event.data.userId,
      organization_id: event.data.organizationId,
      ...(event.data.role?.slug ? { role_slug: event.data.role.slug } : {}),
    });
  }
  return c.json(ok({ received: true }));
});
