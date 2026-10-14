import type { events } from '@coworker/core';
import { z } from 'zod';

type EventRecord = typeof events.$inferSelect;

const delivery_schema = z.strictObject({
  provider: z.string().min(1),
  trigger_slug: z.string().min(1),
  received_time: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export const automation_fire_schema = z
  .object({ trigger_id: z.string().min(1), delivery: delivery_schema.optional() })
  .passthrough();

export type AutomationFire = z.output<typeof automation_fire_schema> & { occurrence_key: string };

export function read_latest_automation_fire(records: EventRecord[]): AutomationFire | null {
  const fires = records
    .filter((record) => record.source === 'trigger')
    .sort((left, right) => left.created_time.getTime() - right.created_time.getTime());
  const latest = fires.at(-1);
  if (!latest) return null;
  const parsed = automation_fire_schema.safeParse(latest.event_body);
  if (!parsed.success) return null;
  return { ...parsed.data, occurrence_key: latest.source_event_id ?? latest.event_id };
}

export function read_all_automation_fires(records: EventRecord[]): AutomationFire[] {
  return records
    .filter((record) => record.source === 'trigger')
    .sort((left, right) => left.created_time.getTime() - right.created_time.getTime())
    .flatMap((record) => {
      const parsed = automation_fire_schema.safeParse(record.event_body);
      return parsed.success
        ? [{ ...parsed.data, occurrence_key: record.source_event_id ?? record.event_id }]
        : [];
    });
}
