import type { Database, event_jobs } from '@coworker/core';
import { run_made_progress } from '@coworker/core/db/queries/run_progress';
import { list_run_messages, list_runs_by_ids } from '@coworker/core/db/queries/sessions';

type EventJob = typeof event_jobs.$inferSelect;
type StartedRun = Awaited<ReturnType<typeof list_runs_by_ids>>[number];

export async function find_finished_event_job_run(
  db: Database,
  input: {
    workspace_id: string;
    event_jobs: EventJob[];
    include_failed_with_final_message?: boolean;
    include_failed_with_progress?: boolean;
  },
) {
  const run_ids = input.event_jobs.flatMap((job) => (job.run_id ? [job.run_id] : []));
  const started_runs = await list_runs_by_ids(db, input.workspace_id, run_ids);
  const finished_run = started_runs.find(
    (run) => run.run_status === 'completed' || run.run_status === 'cancelled',
  );
  if (finished_run) return finished_run;

  const failed_runs = started_runs.filter((run) => run.run_status === 'failed');
  if (input.include_failed_with_progress === true) {
    const acted = await find_failed_run_that_made_progress(db, input.workspace_id, failed_runs);
    if (acted) return acted;
  }
  if (input.include_failed_with_final_message !== true) return undefined;
  return find_failed_run_with_final_message(db, input.workspace_id, failed_runs);
}

async function find_failed_run_that_made_progress(
  db: Database,
  workspace_id: string,
  failed_runs: StartedRun[],
) {
  for (const run of failed_runs) {
    if (await run_made_progress(db, { workspace_id, run_id: run.run_id })) return run;
  }
  return undefined;
}

async function find_failed_run_with_final_message(
  db: Database,
  workspace_id: string,
  failed_runs: StartedRun[],
) {
  const failed_runs_with_messages = await Promise.all(
    failed_runs.map(async (run) => ({
      run,
      messages: await list_run_messages(db, workspace_id, run.run_id),
    })),
  );
  return failed_runs_with_messages.find(({ messages }) =>
    messages.some(
      (message) =>
        message.message_role === 'assistant' &&
        message.is_user_visible &&
        Boolean(message.content_text?.trim()),
    ),
  )?.run;
}
