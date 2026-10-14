import { createHash } from 'node:crypto';
import type { ApiEnv } from '@api/lib/context';
import { error_body, ok } from '@api/lib/response';
import { limit_trigger_delivery_rate } from '@api/lib/trigger_delivery_rate_limit';
import { parse_json_text } from '@api/lib/validate';
import {
  post_composio_trigger_delivery,
  summarize_fires,
} from '@api/routes/trigger_delivery_composio';
import { type FiredTrigger, fire_trigger } from '@api/services/triggers/fire_trigger';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import {
  attio_occurrence_key,
  read_attio_delivery,
  read_attio_event_fields,
  read_attio_event_object_id,
  verify_attio_webhook_signature,
} from '@runtime-platform/attio/attio_webhooks';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { trigger_webhook_secret_matches } from '@runtime-platform/triggers/trigger_webhook_secret';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

export const trigger_delivery_body_byte_limit = 1024 * 1024;
export const app_delivery_body_byte_limit = 10 * 1024 * 1024;

function refuse_bodies_over(max_bytes: number) {
  return bodyLimit({
    maxSize: max_bytes,
    onError: (c: Context) =>
      c.json(
        error_body('delivery_too_large', `A delivery can be at most ${max_bytes} bytes.`),
        413,
      ),
  });
}

const per_trigger_limits = [
  limit_trigger_delivery_rate(),
  refuse_bodies_over(trigger_delivery_body_byte_limit),
] as const;

export const trigger_delivery_routes = new Hono<ApiEnv>()
  .post('/v1/triggers/deliveries/webhook/:trigger_id', ...per_trigger_limits, async (c) => {
    const trigger_id = c.req.param('trigger_id');
    const trigger = await get_trigger_by_id(c.get('db'), trigger_id);
    const presented = read_bearer(c.req.header('authorization'));
    if (
      !trigger ||
      trigger.trigger_type !== 'webhook' ||
      !presented ||
      !trigger_webhook_secret_matches(trigger.trigger_config, presented)
    ) {
      return c.json(error_body('invalid_signature', 'Signature check failed.'), 401);
    }
    if (trigger.trigger_status !== 'enabled') {
      return c.json(ok({ received: false, reason: 'trigger_disabled' }));
    }
    const raw_body = await c.req.text();
    const data = read_generic_webhook_data(raw_body);
    const occurrence_key =
      c.req.header('idempotency-key') ??
      c.req.header('webhook-id') ??
      createHash('sha256').update(raw_body).digest('hex');
    const fired = await fire_trigger(c.get('db'), trigger as TriggerRow, {
      occurrence_key,
      delivery: {
        provider: 'webhook',
        trigger_slug: 'WEBHOOK',
        received_time: new Date().toISOString(),
        data,
      },
      raw_payload: data,
    });
    if (!fired) return c.json(ok({ received: false, reason: 'no_job_handler' }));
    return c.json(
      ok({
        received: true,
        fired: fired.fired,
        trigger_id: fired.trigger_id,
        event_id: fired.event_id,
      }),
      202,
    );
  })
  // Attio's ear. One webhook per trigger, so the address names the trigger and the secret stored
  // on that row is what proves the delivery. Attio retries any non-2xx up to ten times and gives
  // up on a delivery after five seconds, so nothing slower than recording the events happens here.
  .post('/v1/triggers/deliveries/attio/:trigger_id', ...per_trigger_limits, async (c) => {
    const trigger = await get_trigger_by_id(c.get('db'), c.req.param('trigger_id'));
    const raw_body = await c.req.text();
    const secret = trigger?.trigger_config?.webhook_secret;
    if (
      !trigger ||
      trigger.trigger_config.provisioned_by !== 'attio' ||
      !secret ||
      !verify_attio_webhook_signature({
        secret,
        raw_body,
        signature_header: c.req.header('attio-signature'),
      })
    ) {
      return c.json(error_body('invalid_signature', 'Signature check failed.'), 401);
    }
    if (trigger.trigger_status !== 'enabled') {
      return c.json(ok({ received: false, reason: 'trigger_disabled' }));
    }
    const delivery = read_attio_delivery(parse_json_text(raw_body, z.unknown()));
    if (!delivery) {
      return c.json(error_body('invalid_delivery', 'Unreadable delivery envelope.'), 400);
    }

    const idempotency_key = c.req.header('idempotency-key');
    const received_time = new Date().toISOString();
    const fires: FiredTrigger[] = [];
    let matched = 0;
    for (const [index, event] of delivery.events.entries()) {
      const data = read_attio_event_fields(event);
      if (!attio_event_is_for_this_ear(trigger as TriggerRow, data)) continue;
      matched += 1;
      const fired = await fire_trigger(c.get('db'), trigger as TriggerRow, {
        occurrence_key: attio_occurrence_key({ event, index, raw_body, idempotency_key }),
        delivery: { provider: 'attio', trigger_slug: event.event_type, received_time, data },
        raw_payload: event,
      });
      if (fired) fires.push(fired);
    }
    if (matched === 0) return c.json(ok({ received: false, reason: 'no_matching_event' }));
    const answer = summarize_fires(fires);
    if (!answer) return c.json(ok({ received: false, reason: 'no_job_handler' }));
    return c.json(ok(answer), 202);
  })
  .post(
    '/v1/triggers/deliveries/composio',
    refuse_bodies_over(app_delivery_body_byte_limit),
    post_composio_trigger_delivery,
  );

function attio_event_is_for_this_ear(trigger: TriggerRow, fields: Record<string, unknown>) {
  const wanted = trigger.trigger_config.attio_object_id;
  if (!wanted) return true;
  return read_attio_event_object_id(fields) === wanted;
}

function read_generic_webhook_data(raw_body: string): Record<string, unknown> {
  const parsed = read_json_or_raw_text(raw_body);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...parsed };
  return { body: parsed ?? raw_body };
}

function read_json_or_raw_text(raw_body: string): unknown {
  try {
    return JSON.parse(raw_body);
  } catch (error) {
    if (error instanceof SyntaxError) return raw_body;
    throw error;
  }
}

function read_bearer(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/iu);
  return match?.[1] ?? null;
}
