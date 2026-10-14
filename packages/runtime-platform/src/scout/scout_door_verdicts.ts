import { type Database, event_jobs } from '@coworker/core';
import { and, eq, inArray } from 'drizzle-orm';

export async function read_door_verdicts(db: Database, event_ids: string[]) {
  const verdicts = new Map<string, string>();
  if (event_ids.length === 0) return verdicts;
  const rows = await db
    .select({ event_id: event_jobs.event_id, result_data: event_jobs.result_data })
    .from(event_jobs)
    .where(
      and(inArray(event_jobs.event_id, event_ids), eq(event_jobs.job_handler, 'run_automation')),
    );
  for (const row of rows) {
    if (!row.event_id) continue;
    const verdict = describe_door_verdict(row.result_data);
    if (verdict) verdicts.set(row.event_id, verdict);
  }
  return verdicts;
}

function describe_door_verdict(result_data: unknown): string | null {
  const data = result_data as {
    ran?: unknown;
    skipped?: { stage?: unknown; reason?: unknown };
  } | null;
  if (!data) return null;
  if (data.ran === true) return 'ran: an automation handled it';
  const stage = typeof data.skipped?.stage === 'string' ? data.skipped.stage : null;
  if (!stage) return null;
  const reason = typeof data.skipped?.reason === 'string' ? data.skipped.reason.slice(0, 120) : '';
  return `${stage}: ${reason}`.trim();
}
