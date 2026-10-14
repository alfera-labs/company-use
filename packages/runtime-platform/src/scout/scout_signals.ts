import { type Database, events } from '@coworker/core';
import { read_door_verdicts } from '@runtime-platform/scout/scout_door_verdicts';
import { and, desc, eq, gte, ne, or, sql } from 'drizzle-orm';

const signal_window_days = 3;

export type ScoutSignal = {
  event_id: string;
  source: string;
  event_type: string;
  title: string;
  created_time: string;
  sender: string | null;
  subject_id: string;
  door: string | null;
};

export async function list_recent_signals(
  db: Database,
  input: { workspace_id: string; now: Date; limit: number },
): Promise<ScoutSignal[]> {
  const since = new Date(input.now.getTime() - signal_window_days * 24 * 60 * 60 * 1_000);
  const rows = await db
    .select({
      event_id: events.event_id,
      source: events.source,
      event_type: events.event_type,
      queue_key: events.queue_key,
      actor_key: events.actor_key,
      event_body: events.event_body,
      created_time: events.created_time,
    })
    .from(events)
    .where(
      and(
        eq(events.workspace_id, input.workspace_id),
        gte(events.created_time, since),
        or(ne(events.source, 'trigger'), sql`${events.event_body} -> 'delivery' is not null`),
      ),
    )
    .orderBy(desc(events.created_time))
    .limit(input.limit);

  const doors = await read_door_verdicts(
    db,
    rows.map((row) => row.event_id),
  );
  return rows.map((row) => {
    const delivery = read_delivery(row.event_body);
    const body = delivery?.data ?? row.event_body;
    return {
      event_id: row.event_id,
      source: delivery ? app_name_of_trigger_slug(delivery.trigger_slug) : row.source,
      event_type: delivery ? delivery.trigger_slug : row.event_type,
      title: read_signal_field(body, title_fields) ?? row.queue_key,
      created_time: row.created_time.toISOString(),
      sender: read_signal_field(body, sender_fields) ?? row.actor_key,
      subject_id: row.queue_key,
      door: doors.get(row.event_id) ?? null,
    };
  });
}

function read_delivery(event_body: unknown) {
  const delivery = (event_body as { delivery?: unknown } | null)?.delivery;
  if (!delivery || typeof delivery !== 'object') return null;
  const { trigger_slug, data } = delivery as { trigger_slug?: unknown; data?: unknown };
  if (typeof trigger_slug !== 'string' || !trigger_slug.trim()) return null;
  return { trigger_slug, data: (data ?? null) as Record<string, unknown> | null };
}

function app_name_of_trigger_slug(trigger_slug: string) {
  return (trigger_slug.split('_')[0] ?? trigger_slug).toLowerCase();
}

const title_fields = ['title', 'subject', 'summary', 'raw_text', 'text', 'name'] as const;
const sender_fields = ['from', 'sender', 'from_email', 'user_email', 'actor', 'author'] as const;

function read_signal_field(event_body: unknown, fields: readonly string[]): string | null {
  const body = event_body as Record<string, unknown> | null;
  if (!body) return null;
  for (const field of fields) {
    const value = body[field];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200);
  }
  return null;
}
