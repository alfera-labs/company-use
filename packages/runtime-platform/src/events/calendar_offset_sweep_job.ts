import type { Database, events } from '@coworker/core';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { sweep_calendar_offsets } from '@runtime-platform/automations/calendar_offset_sweep';
import {
  read_fired_system_trigger,
  system_job_skipped,
} from '@runtime-platform/events/system_trigger_fire';

export async function run_calendar_offset_sweep_job(input: {
  db: Database;
  workspace_id: string;
  events: (typeof events.$inferSelect)[];
  now?: Date;
}): Promise<EventJobHandlerResult> {
  const fire = await read_fired_system_trigger(input.db, input.events);
  if (!fire) return system_job_skipped('No system trigger fire was available.', 'no_trigger');

  const result = await sweep_calendar_offsets(input.db, {
    workspace_id: input.workspace_id,
    agent_id: fire.trigger.agent_id,
    now: input.now ?? new Date(),
  });
  return { job_status: 'done', result_data: result };
}
