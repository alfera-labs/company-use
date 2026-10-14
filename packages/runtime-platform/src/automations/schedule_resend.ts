import type { Database } from '@coworker/core';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import { triggers as triggers_table } from '@coworker/core/db/schema';
import { unchanged_lifecycle_columns } from '@coworker/core/db/schema/common';
import { create_logger, format_error_message } from '@coworker/shared';
import { read_automation_lifecycle } from '@runtime-platform/automations/automation_lifecycle';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { eq, sql } from 'drizzle-orm';

// A schedule ear is committed first and sent to the cloud scheduler after commit. A process that
// died in between leaves the row enabled with no cron behind it: deaf, and nothing ever says so.
// So the watchdog sends every schedule changed since it last sent it, once. `set_schedule` is
// create-or-replace, so sending a cron that already exists changes nothing.
// Once per edit, not once per tick. Every tick would be 2 scheduler calls per schedule
// every 15 minutes across the fleet, and every call is a chance to revive a cron just paused.

const log = create_logger('schedule_resend');

const resend_grace_minutes = 10;

export async function resend_unconfirmed_schedules(
  db: Database,
  triggers: TriggerRow[],
  now: Date,
): Promise<string[]> {
  const resent: string[] = [];
  for (const trigger of triggers.filter((candidate) => needs_resend(candidate, now))) {
    const current = await get_trigger_by_id(db, trigger.trigger_id);
    if (!current || !needs_resend(current, now)) continue;
    try {
      await read_automation_lifecycle().reprovision_trigger_schedule(current);
    } catch (error) {
      log.error('a schedule could not be sent again', {
        trigger_id: current.trigger_id,
        error: format_error_message(error),
      });
      continue;
    }
    await stamp_schedule_sent(db, current.trigger_id, now);
    resent.push(current.trigger_id);
  }
  return resent;
}

function needs_resend(trigger: TriggerRow, now: Date) {
  if (trigger.trigger_type !== 'schedule' || trigger.trigger_status !== 'enabled') return false;
  const changed_at = trigger.last_updated_time.getTime();
  if (now.getTime() - changed_at < resend_grace_minutes * 60_000) return false;
  const sent_time = trigger.trigger_config.schedule_sent_time;
  return typeof sent_time !== 'string' || Date.parse(sent_time) < changed_at;
}

async function stamp_schedule_sent(db: Database, trigger_id: string, now: Date) {
  const stamp = JSON.stringify({ schedule_sent_time: now.toISOString() });
  await db
    .update(triggers_table)
    .set({
      trigger_config: sql`${triggers_table.trigger_config} || ${stamp}::jsonb`,
      ...unchanged_lifecycle_columns(triggers_table),
    })
    .where(eq(triggers_table.trigger_id, trigger_id));
}
