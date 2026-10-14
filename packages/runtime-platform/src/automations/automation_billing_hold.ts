import type { Database, event_jobs } from '@coworker/core';
import type { EventJobHandlerResult } from '@coworker/jobs';

type EventJob = typeof event_jobs.$inferSelect;

export async function automation_fire_still_waiting_for_credit(
  _db: Database,
  _input: { workspace_id: string; event_jobs: EventJob[] },
): Promise<EventJobHandlerResult | null> {
  return null;
}

export function hold_automation_fire_for_billing_refusal(
  error: unknown,
  _event_jobs: EventJob[],
): { held: EventJobHandlerResult } {
  throw error;
}
