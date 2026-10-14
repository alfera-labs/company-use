import { createHash, createHmac } from 'node:crypto';
import { secure_strings_equal } from '@coworker/shared/secure_strings_equal';
import { z } from 'zod';

// Attio signs the raw body with that webhook's own secret: hex HMAC-SHA256, in `Attio-Signature`.
// There is no timestamp header to bound a replay with, so the occurrence key is what makes a
// repeated body harmless.
export function verify_attio_webhook_signature(input: {
  secret: string;
  raw_body: string;
  signature_header: string | undefined;
}): boolean {
  if (!input.secret || !input.signature_header) return false;
  const expected = createHmac('sha256', input.secret).update(input.raw_body).digest('hex');
  return secure_strings_equal(expected, input.signature_header.trim());
}

const attio_event_schema = z
  .object({
    event_type: z.string(),
    // Which ids live here depends on the event: a record event carries object_id and record_id, a
    // note event a note_id, a list event a list_id and an entry_id.
    id: z.record(z.string(), z.unknown()).default({}),
    actor: z
      .object({ type: z.string().nullish(), id: z.string().nullish() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const attio_delivery_schema = z
  .object({
    webhook_id: z.string().optional(),
    events: z.array(attio_event_schema).min(1),
  })
  .passthrough();

export type AttioWebhookEvent = z.infer<typeof attio_event_schema>;
export type AttioWebhookDelivery = z.infer<typeof attio_delivery_schema>;

export function read_attio_delivery(payload: unknown): AttioWebhookDelivery | null {
  const parsed = attio_delivery_schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export function read_attio_event_fields(event: AttioWebhookEvent): Record<string, unknown> {
  const id = event.id;
  const loose = event as Record<string, unknown>;
  const fields = {
    event_type: event.event_type,
    record_id: id.record_id,
    object_id: id.object_id,
    note_id: id.note_id,
    list_id: id.list_id,
    entry_id: id.entry_id,
    // A note names its parent at the root on some events and inside `id` on others; both read here.
    parent_object: loose.parent_object_id ?? id.parent_object_id,
    parent_record_id: loose.parent_record_id ?? id.parent_record_id,
    actor_type: event.actor?.type ?? undefined,
    actor_id: event.actor?.id ?? undefined,
  };
  return {
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
    event,
  };
}

const attio_event_types_that_happen_once = new Set(['record.created', 'note.created']);

/**
 * The key that makes a repeated delivery fire once. Attio signs the body and nothing else, so the
 * `Idempotency-Key` header is not proof: whoever holds a copy of a signed delivery can send it
 * again under a new one. A created event names an id that is new, so the same signed bytes can
 * never honestly arrive twice, and the key is the body itself. An updated event carries no time
 * and no event id: two real changes to one record are the same bytes, and only the header tells
 * them apart. Keying those by the body would drop every change after the first.
 * A copied "updated" delivery can therefore still fire again; it stops being possible
 * the day Attio signs a timestamp or an event id.
 */
export function attio_occurrence_key(input: {
  event: AttioWebhookEvent;
  index: number;
  raw_body: string;
  idempotency_key: string | undefined;
}): string {
  const body_hash = createHash('sha256').update(input.raw_body).digest('hex');
  const delivery_key = attio_event_types_that_happen_once.has(input.event.event_type)
    ? body_hash
    : (input.idempotency_key ?? body_hash);
  return `${delivery_key}:${input.index}`;
}

export function read_attio_event_object_id(fields: Record<string, unknown>): unknown {
  return fields.object_id ?? fields.parent_object;
}
