import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import {
  create_run,
  create_session,
  recover_stale_running_runs,
} from '@coworker/core/db/queries/sessions';
import { event_jobs, runs, sessions } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

type Db = Awaited<ReturnType<typeof create_test_database>>;

async function seed_abandoned_run_with_job(db: Db, job_status: string) {
  const workspace = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: workspace.workspace_id,
    agent_id: workspace.agent_id,
    actor_id: workspace.user_id,
  });
  const run = await create_run(db, {
    workspace_id: workspace.workspace_id,
    session_id: session.session_id,
    agent_id: workspace.agent_id,
    trigger_type: 'api',
    actor_id: workspace.user_id,
  });
  await db.update(runs).set({ run_status: 'running' }).where(eq(runs.run_id, run.run_id));
  await db
    .update(sessions)
    .set({
      locked_by_run_id: run.run_id,
      active_run_id: run.run_id,
      lock_expires_time: new Date(Date.now() - 60_000),
    })
    .where(eq(sessions.session_id, session.session_id));
  const queued = await enqueue_event_jobs(db, {
    workspace_id: workspace.workspace_id,
    source: 'test',
    source_event_id: `reaper-${job_status}`,
    event_type: 'test.reaper',
    queue_key: `session:${session.session_id}`,
    actor_key: workspace.user_id,
    event_jobs: [{ job_handler: 'api_answer_job' }],
  });
  const job = queued.event_jobs[0];
  if (!job) throw new Error('Failed to enqueue the reaper job.');
  await db
    .update(event_jobs)
    .set({ run_id: run.run_id, job_status })
    .where(eq(event_jobs.job_id, job.job_id));
  return { workspace_id: workspace.workspace_id, run_id: run.run_id, job_id: job.job_id };
}

async function read_run_status(db: Db, run_id: string) {
  return (await db.query.runs.findFirst({ where: eq(runs.run_id, run_id) }))?.run_status;
}

describe('stale-run reaper and runs a job will continue', () => {
  it.each(['queued', 'running'])('leaves a run alone while its job is %s', async (job_status) => {
    const db = await create_test_database();
    const seeded = await seed_abandoned_run_with_job(db, job_status);

    const recovered = await recover_stale_running_runs(db, { workspace_id: seeded.workspace_id });

    expect(recovered.map((run) => run.run_id)).not.toContain(seeded.run_id);
    expect(await read_run_status(db, seeded.run_id)).toBe('running');
  });

  it.each(['done', 'failed', 'dead'])('fails the run once its job is %s', async (job_status) => {
    const db = await create_test_database();
    const seeded = await seed_abandoned_run_with_job(db, job_status);

    const recovered = await recover_stale_running_runs(db, { workspace_id: seeded.workspace_id });

    expect(recovered.map((run) => run.run_id)).toContain(seeded.run_id);
    expect(await read_run_status(db, seeded.run_id)).toBe('failed');
  });

  it('also leaves a run with no session lock alone while its job lives', async () => {
    const db = await create_test_database();
    const seeded = await seed_abandoned_run_with_job(db, 'queued');
    await db
      .update(sessions)
      .set({ locked_by_run_id: null, active_run_id: null, lock_expires_time: null })
      .where(eq(sessions.workspace_id, seeded.workspace_id));
    await db
      .update(runs)
      .set({ last_updated_time: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(runs.run_id, seeded.run_id));

    const recovered = await recover_stale_running_runs(db, { workspace_id: seeded.workspace_id });

    expect(recovered.map((run) => run.run_id)).not.toContain(seeded.run_id);
  });
});
