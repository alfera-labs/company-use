import { count_database_statements } from '@coworker/core/db/database_statement_count';
import { count_label, format_duration } from '@coworker/jobs/event_job_log_labels';
import { run_with_a_queue_run_slot } from '@coworker/jobs/event_job_run_slots';
import { create_logger } from '@coworker/shared';

const log = create_logger('event_job_runner');

export function run_counted_in_a_queue_run_slot<
  T extends { ran_jobs: boolean; event_jobs: unknown[] },
>(run_one: () => Promise<T>, input: { label: string; queue_key?: string }): Promise<T> {
  return run_with_a_queue_run_slot(async () => {
    const started_time = Date.now();
    const { result, statement_count } = await count_database_statements(run_one);
    if (result.ran_jobs) {
      log.info(
        `ran ${count_label(result.event_jobs.length, 'job')} for ${input.label} in ${format_duration(Date.now() - started_time)} with ${count_label(statement_count, 'database statement')}`,
      );
    }
    return result;
  }, input);
}
