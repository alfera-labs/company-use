import { type Database, event_jobs as event_jobs_table, type events } from '@coworker/core';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger, format_error_message } from '@coworker/shared';
import { run_automation_miner_job } from '@runtime-platform/events/automation_miner_job';
import { run_automation_watchdog_job } from '@runtime-platform/events/automation_watchdog_job';
import { run_calendar_offset_sweep_job } from '@runtime-platform/events/calendar_offset_sweep_job';
import { run_daily_summary_job } from '@runtime-platform/events/daily_summary_job';
import {
  read_fired_system_trigger,
  system_job_skipped,
} from '@runtime-platform/events/system_trigger_fire';
import { local_minutes_of_day } from '@runtime-platform/notifications/notification_clock';
import { and, eq, gte, sql } from 'drizzle-orm';

const log = create_logger('attention_tick');
const attention_tick_job_handler = 'run_attention_tick';

type EventRecord = typeof events.$inferSelect;
type Chore = (input: TickInput) => Promise<EventJobHandlerResult>;

export type TickInput = {
  db: Database;
  workspace_id: string;
  events: EventRecord[];
  now?: Date;
};

const chores: Record<string, Chore> = {
  daily_summary: run_daily_summary_job,
  watchdog: run_automation_watchdog_job,
  calendar: run_calendar_offset_sweep_job,
  miner: mine_once_a_week,
};

export async function run_attention_tick_job(input: TickInput): Promise<EventJobHandlerResult> {
  const fire = await read_fired_system_trigger(input.db, input.events);
  if (!fire) return system_job_skipped('No system trigger fire was available.', 'no_trigger');

  const result_data: Record<string, unknown> = { ran: true };
  for (const [name, chore] of Object.entries(chores)) {
    try {
      result_data[name] = (await chore(input)).result_data ?? {};
    } catch (error) {
      const message = format_error_message(error);
      log.error('a tick chore failed; the others still ran', {
        workspace_id: input.workspace_id,
        chore: name,
        message,
      });
      result_data[name] = { failed: message };
    }
  }
  return { job_status: 'done', result_data };
}

const miner_local_day = 0;
const miner_from_minutes = 18 * 60;
const one_week_ms = 7 * 24 * 60 * 60 * 1000;

async function mine_once_a_week(input: TickInput): Promise<EventJobHandlerResult> {
  const now = input.now ?? new Date();
  const fire = await read_fired_system_trigger(input.db, input.events);
  const timezone = fire?.trigger.trigger_config?.timezone ?? 'UTC';
  const local = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  if (
    local.getDay() !== miner_local_day ||
    local_minutes_of_day(now, timezone) < miner_from_minutes
  ) {
    return system_job_skipped('Not Sunday evening yet.', 'not_mining_time');
  }
  const [already] = await input.db
    .select({ job_id: event_jobs_table.job_id })
    .from(event_jobs_table)
    .where(
      and(
        eq(event_jobs_table.workspace_id, input.workspace_id),
        eq(event_jobs_table.job_handler, attention_tick_job_handler),
        gte(event_jobs_table.created_time, new Date(now.getTime() - one_week_ms)),
        sql`${event_jobs_table.result_data} -> 'miner' ->> 'ran' = 'true'`,
      ),
    )
    .limit(1);
  if (already) return system_job_skipped('The week was already mined.', 'mined_this_week');
  return run_automation_miner_job(input);
}
