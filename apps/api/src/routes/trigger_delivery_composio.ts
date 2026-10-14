import type { ApiEnv } from '@api/lib/context';
import { error_body, ok } from '@api/lib/response';
import { parse_json_text } from '@api/lib/validate';
import { forward_unowned_composio_delivery } from '@api/services/triggers/composio_delivery_forward';
import { find_listening_triggers } from '@api/services/triggers/composio_delivery_listeners';
import { type FiredTrigger, fire_trigger } from '@api/services/triggers/fire_trigger';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  type ComposioWebhookEvent,
  read_composio_webhook_event,
  verify_composio_webhook_signature,
} from '@coworker/runtime-platform';
import { create_logger } from '@coworker/shared';
import { queue_debounced_crawl_for_composio_change_delivery } from '@runtime-platform/brain/composio_change_delivery';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import type { Context } from 'hono';
import { z } from 'zod';

const log = create_logger('trigger_deliveries');

function read_delivery(envelope: ComposioWebhookEvent) {
  return {
    provider: 'composio',
    trigger_slug: envelope.metadata.trigger_slug,
    received_time: envelope.timestamp ?? new Date().toISOString(),
    data: envelope.data,
  };
}

export function summarize_fires(fires: FiredTrigger[]) {
  const first = fires[0];
  if (!first) return null;
  return {
    received: true,
    fired: fires.some((fire) => fire.fired),
    trigger_id: first.trigger_id,
    event_id: first.event_id,
    queued_job_count: fires.reduce((total, fire) => total + fire.queued_job_count, 0),
    fires: fires.map((fire) => ({
      trigger_id: fire.trigger_id,
      event_id: fire.event_id,
      fired: fire.fired,
    })),
  };
}

async function fire_every_listening_trigger(
  db: Database,
  triggers: readonly TriggerRow[],
  envelope: ComposioWebhookEvent,
  webhook_id: string,
): Promise<FiredTrigger[]> {
  const delivery = read_delivery(envelope);
  const fires: FiredTrigger[] = [];
  for (const trigger of triggers) {
    const fired = await fire_trigger(db, trigger, {
      occurrence_key: webhook_id,
      delivery,
      raw_payload: envelope,
    });
    if (fired) fires.push(fired);
  }
  return fires;
}

type VerifiedComposioDelivery =
  | { outcome: 'secret_missing' }
  | { outcome: 'invalid_signature' }
  | { outcome: 'invalid_delivery' }
  | { outcome: 'ok'; envelope: ComposioWebhookEvent; webhook_id: string; raw_body: string };

async function verify_and_read_composio_delivery(
  c: Context<ApiEnv>,
): Promise<VerifiedComposioDelivery> {
  const secret = env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret) {
    log.error('A Composio delivery arrived with no COMPOSIO_WEBHOOK_SECRET configured');
    return { outcome: 'secret_missing' };
  }

  const raw_body = await c.req.text();
  const webhook_id = c.req.header('webhook-id') ?? '';
  const verified = verify_composio_webhook_signature({
    secret,
    raw_body,
    webhook_id,
    signature_header: c.req.header('webhook-signature') ?? '',
    timestamp_header: c.req.header('webhook-timestamp'),
  });
  if (!verified) {
    log.warn('Rejected a Composio delivery with an invalid signature', { webhook_id });
    return { outcome: 'invalid_signature' };
  }

  const envelope = read_composio_webhook_event(parse_json_text(raw_body, z.unknown()));
  if (!envelope) return { outcome: 'invalid_delivery' };
  return { outcome: 'ok', envelope, webhook_id, raw_body };
}

function response_for_rejected_delivery(c: Context<ApiEnv>, outcome: VerifiedComposioDelivery) {
  if (outcome.outcome === 'secret_missing') {
    return c.json(
      error_body('composio_webhook_secret_missing', 'Trigger deliveries are not set up.'),
      503,
    );
  }
  if (outcome.outcome === 'invalid_signature') {
    return c.json(error_body('invalid_signature', 'Signature check failed.'), 401);
  }
  return c.json(error_body('invalid_delivery', 'Unreadable delivery envelope.'), 400);
}

export async function post_composio_trigger_delivery(c: Context<ApiEnv>) {
  const verified = await verify_and_read_composio_delivery(c);
  if (verified.outcome !== 'ok') return response_for_rejected_delivery(c, verified);
  const { envelope, webhook_id, raw_body } = verified;

  const connected_account_id = envelope.metadata.connected_account_id;
  if (connected_account_id) {
    await queue_debounced_crawl_for_composio_change_delivery(c.get('db'), {
      connected_account_id,
      actor_id: 'system:composio_change_delivery',
    });
  }

  const listening = await find_listening_triggers(c.get('db'), envelope, webhook_id);
  if ('reason' in listening && listening.reason === 'no_trigger') {
    const headers = c.req.raw.headers;
    return c.json(ok(await forward_unowned_composio_delivery({ headers, raw_body })));
  }
  if ('reason' in listening) return c.json(ok({ received: false, reason: listening.reason }));

  const fires = await fire_every_listening_trigger(
    c.get('db'),
    listening.triggers,
    envelope,
    webhook_id,
  );
  const answer = summarize_fires(fires);
  if (!answer) return c.json(ok({ received: false, reason: 'no_job_handler' }));
  return c.json(ok(answer), 202);
}
