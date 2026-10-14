import type { Database } from '@coworker/core';
import {
  advance_trigger_schedule,
  list_due_schedule_triggers,
} from '@coworker/core/db/queries/trigger_scheduling';
import { queue_and_run_event_jobs } from '@coworker/jobs';
import { create_logger, format_error_message } from '@coworker/shared';
import { find_automation_fire_keys } from '@runtime-platform/automations/automation_subject';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { next_cron_run_time } from '@runtime-platform/events/next_schedule_run_time';
import {
  prepare_trigger_fire_event,
  read_trigger_schedule,
} from '@runtime-platform/events/trigger_ingress';
import { keep_scheduled_tasks_of_current_members } from '@runtime-platform/events/trigger_member_gate';
import { expire_overdue_waits } from '@runtime-platform/events/wait_expiry_sweep';

const log = create_logger('schedule_trigger_loop');
const poll_interval_ms = 15_000;

export function start_schedule_trigger_loop(db: Database) {
  let running = false;

  const run_tick = () => {
    if (running) return;
    running = true;
    fire_due_schedules_and_expire_waits(db)
      .catch((error) => {
        log.error('tick failed', {
          error: format_error_message(error),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(run_tick, poll_interval_ms);
  if (typeof timer.unref === 'function') timer.unref();
  run_tick();
  return () => clearInterval(timer);
}

export function fire_due_schedules_and_expire_waits(db: Database) {
  return Promise.all([fire_due_schedule_triggers(db), expire_overdue_waits(db)]);
}

export async function fire_due_schedule_triggers(db: Database, now = new Date()) {
  const due = await keep_scheduled_tasks_of_current_members(
    db,
    await list_due_schedule_triggers(db, { now }),
  );
  let fired = 0;

  for (const trigger of due) {
    const schedule = read_trigger_schedule(trigger);
    if (!schedule) continue;

    const due_time = schedule.run_once_at ? new Date(schedule.run_once_at) : trigger.next_run_time;

    if (!due_time || Number.isNaN(due_time.getTime())) {
      const first_run_time = next_cron_run_time(schedule, now);
      if (first_run_time) await advance(db, trigger, { next_run_time: first_run_time });
      continue;
    }

    if (due_time > now) {
      if (!trigger.next_run_time) await advance(db, trigger, { next_run_time: due_time });
      continue;
    }

    const occurrence_key = due_time.toISOString();
    const keys = await find_automation_fire_keys(db, trigger, { occurrence_key });
    const prepared = prepare_trigger_fire_event(trigger, {
      occurrence_key,
      ...(keys ? { queue_key: keys.queue_key } : {}),
    });
    if (prepared) {
      const result = await queue_and_run_event_jobs(db, prepared.event, find_event_job_handler);
      if (result.created) fired += 1;
    }

    const next_run_time = next_cron_run_time(schedule, now);
    await advance(db, trigger, {
      next_run_time: next_run_time ?? due_time,
      last_run_time: now,
    });
  }

  return { due: due.length, fired };
}

function advance(
  db: Database,
  trigger: { workspace_id: string; trigger_id: string },
  input: { next_run_time: Date; last_run_time?: Date },
) {
  return advance_trigger_schedule(db, {
    workspace_id: trigger.workspace_id,
    trigger_id: trigger.trigger_id,
    ...input,
  });
}
