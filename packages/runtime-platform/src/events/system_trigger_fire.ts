import type { Database } from '@coworker/core';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import type { events } from '@coworker/core/db/schema';
import { z } from 'zod';

type EventRecord = typeof events.$inferSelect;

const trigger_fire_body_schema = z.object({ trigger_id: z.string().min(1) }).passthrough();

export async function read_fired_system_trigger(db: Database, records: EventRecord[]) {
  const latest = records
    .filter((record) => record.source === 'trigger')
    .sort((left, right) => left.created_time.getTime() - right.created_time.getTime())
    .at(-1);
  if (!latest) return null;

  const parsed = trigger_fire_body_schema.safeParse(latest.event_body);
  if (!parsed.success) return null;

  const trigger = await get_trigger_by_id(db, parsed.data.trigger_id);
  return trigger ? { trigger, event: latest } : null;
}

export function system_job_skipped(message: string, code: string) {
  return { job_status: 'done' as const, result_data: { ran: false, code, message } };
}
