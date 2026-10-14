import type { Database } from '@coworker/core/db/connection';
import {
  brain_source_next_sync_time,
  brain_source_syncs_on_schedule,
} from '@coworker/core/db/queries/brain_source_sync_schedule';
import { pending_connection_setup_expiry_ms } from '@coworker/core/db/queries/connection_management';
import { read_execute_rows } from '@coworker/core/db/queries/read_execute_rows';
import { active_run_statuses, orphan_running_run_ms } from '@coworker/core/db/queries/sessions';
import {
  brain_sources,
  connections,
  event_jobs,
  runs,
  sessions,
  triggers,
} from '@coworker/core/db/schema';
import { sql } from 'drizzle-orm';

export async function find_next_due_work_time(
  db: Database,
  input: { stale_wake_ms: number },
): Promise<Date | null> {
  const live = sql.join(
    active_run_statuses.map((status) => sql`${status}`),
    sql`, `,
  );
  const no_job_continues_run = sql`not exists (select 1 from ${event_jobs} j
    where j.workspace_id = r.workspace_id and j.run_id = r.run_id
      and j.job_status in ('queued', 'running'))`;
  const result = await db.execute(sql`select least(
    (select min(greatest(available_time,
        coalesce(wake_sent_time, available_time) + ${input.stale_wake_ms}::int * interval '1 ms'))
      from ${event_jobs} where job_status = 'queued'),
    (select min(locked_until) from ${event_jobs} where job_status = 'running'),
    (select min(awaits_until_time) from ${event_jobs} where job_status = 'waiting'),
    (select min(next_run_time) from ${triggers}
      where trigger_type = 'schedule' and trigger_status = 'enabled'
        and schedule_expression is not null
        and (last_run_time is null or next_run_time > last_run_time)),
    (select min(coalesce(s.lock_expires_time, now())) from ${runs} r
      join ${sessions} s on s.workspace_id = r.workspace_id and s.session_id = r.session_id
        and s.locked_by_run_id = r.run_id
      where r.run_status in (${live}) and ${no_job_continues_run}),
    (select min(r.last_updated_time + ${orphan_running_run_ms}::int * interval '1 ms') from ${runs} r
      where r.run_status in (${live}) and ${no_job_continues_run}
        and not exists (select 1 from ${sessions} s where s.workspace_id = r.workspace_id
          and s.session_id = r.session_id and s.locked_by_run_id = r.run_id)),
    (select min(greatest(created_time, coalesce(
        nullif(setup_state->>'setup_started_time', '')::timestamptz, created_time))
        + ${pending_connection_setup_expiry_ms}::int * interval '1 ms')
      from ${connections} where connection_status = 'pending_setup'),
    (select min(coalesce(${brain_source_next_sync_time}, now()))
      from ${brain_sources} where ${brain_source_syncs_on_schedule})
  ) as due_time`);
  const [row] = read_execute_rows<{ due_time: Date | string | null }>(result);
  return row?.due_time ? new Date(row.due_time) : null;
}
