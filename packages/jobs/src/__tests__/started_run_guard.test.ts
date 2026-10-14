import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { event_jobs, runs, sessions } from '@coworker/core/db/schema';
import { run_queue_jobs } from '@coworker/jobs/event_job_runner';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const find_no_event_job_handler = () => null;

type Db = Awaited<ReturnType<typeof create_test_database>>;

async function seed_job_with_started_run(
  db: Db,
  input: {
    run_status: string;
    lock: 'live' | 'expired' | 'none';
    source_event_id: string;
    interruption_count?: number;
  },
) {
  const workspace = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: workspace.workspace_id,
    agent_id: workspace.agent_id,
    session_title: 'Started-run guard',
    actor_id: workspace.user_id,
  });
  const run = await create_run(db, {
    workspace_id: workspace.workspace_id,
    session_id: session.session_id,
    agent_id: workspace.agent_id,
    trigger_type: 'api',
    actor_id: workspace.user_id,
  });
  await db.update(runs).set({ run_status: input.run_status }).where(eq(runs.run_id, run.run_id));
  if (input.lock !== 'none') {
    const offset_ms = input.lock === 'live' ? 60_000 : -60_000;
    await db
      .update(sessions)
      .set({
        locked_by_run_id: run.run_id,
        active_run_id: run.run_id,
        lock_expires_time: new Date(Date.now() + offset_ms),
      })
      .where(eq(sessions.session_id, session.session_id));
  }
  const queue_key = `session:${session.session_id}`;
  const queued = await enqueue_event_jobs(db, {
    workspace_id: workspace.workspace_id,
    source: 'test',
    source_event_id: input.source_event_id,
    event_type: 'test.started_run',
    queue_key,
    actor_key: workspace.user_id,
    event_jobs: [{ job_handler: 'missing_handler_that_must_not_run' }],
  });
  const job = queued.event_jobs[0];
  if (!job) throw new Error('Failed to enqueue started-run guard job.');
  await db
    .update(event_jobs)
    .set({ run_id: run.run_id, interruption_count: input.interruption_count ?? 0 })
    .where(eq(event_jobs.job_id, job.job_id));
  return { workspace_id: workspace.workspace_id, queue_key, job_id: job.job_id };
}

async function run_and_read_job(
  db: Db,
  seeded: Awaited<ReturnType<typeof seed_job_with_started_run>>,
) {
  await run_queue_jobs(
    db,
    { workspace_id: seeded.workspace_id, queue_key: seeded.queue_key },
    find_no_event_job_handler,
  );
  return db.query.event_jobs.findFirst({ where: eq(event_jobs.job_id, seeded.job_id) });
}

describe('started event-job run guard', () => {
  it.each([
    'queued',
    'starting',
    'running',
  ])('waits for a %s run whose worker still holds the session', async (run_status) => {
    const db = await create_test_database();
    const seeded = await seed_job_with_started_run(db, {
      run_status,
      lock: 'live',
      source_event_id: `started-run-${run_status}`,
    });

    const stored_job = await run_and_read_job(db, seeded);

    expect(stored_job?.job_status).toBe('queued');
    expect(stored_job?.error_data).toMatchObject({
      code: 'event_job_started_run_still_active',
      run_status,
    });
  });

  it('waits for a run parked on a question, which holds no lock', async () => {
    const db = await create_test_database();
    const seeded = await seed_job_with_started_run(db, {
      run_status: 'waiting',
      lock: 'none',
      source_event_id: 'started-run-waiting',
    });

    const stored_job = await run_and_read_job(db, seeded);

    expect(stored_job?.error_data).toMatchObject({
      code: 'event_job_started_run_still_active',
      run_status: 'waiting',
    });
  });

  it('hands an interrupted job to its handler while its own run still holds a live lock', async () => {
    const db = await create_test_database();
    const seeded = await seed_job_with_started_run(db, {
      run_status: 'running',
      lock: 'live',
      source_event_id: 'started-run-interrupted',
      interruption_count: 1,
    });

    const stored_job = await run_and_read_job(db, seeded);

    expect(stored_job?.error_data).toMatchObject({ code: 'event_job_handler_missing' });
  });

  it('still waits for a run parked on a question when the job was interrupted', async () => {
    const db = await create_test_database();
    const seeded = await seed_job_with_started_run(db, {
      run_status: 'waiting',
      lock: 'none',
      source_event_id: 'started-run-interrupted-waiting',
      interruption_count: 1,
    });

    const stored_job = await run_and_read_job(db, seeded);

    expect(stored_job?.error_data).toMatchObject({
      code: 'event_job_started_run_still_active',
      run_status: 'waiting',
    });
  });

  it.each([
    'expired',
    'none',
  ] as const)('hands the job to its handler when the started run has a %s lock', async (lock) => {
    const db = await create_test_database();
    const seeded = await seed_job_with_started_run(db, {
      run_status: 'running',
      lock,
      source_event_id: `started-run-abandoned-${lock}`,
    });

    const stored_job = await run_and_read_job(db, seeded);

    expect(stored_job?.error_data).toMatchObject({ code: 'event_job_handler_missing' });
  });
});
