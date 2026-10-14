import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { event_jobs, workspaces } from '@coworker/core/db/schema';
import {
  claim_next_ready_event_jobs,
  claim_ready_event_jobs_for_queue,
  event_job_queue_barrier_metadata_key,
  extend_event_job_lock,
  find_next_queued_event_job_for_queue,
  list_events_for_event_jobs,
  list_ready_event_job_queues,
  recover_expired_event_jobs,
  save_event_job_progress,
  save_event_job_result,
  set_event_jobs_run_id,
} from '@coworker/jobs';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('events queue', () => {
  it('stores a durable event and queues jobs once per source event', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const event = build_event_input(bootstrap.workspace_id, 'EvOnce');

    const first_result = await enqueue_event_jobs(db, event);
    const duplicate_result = await enqueue_event_jobs(db, event);

    const jobs = await db.query.event_jobs.findMany({
      where: eq(event_jobs.event_id, first_result.event.event_id),
    });

    expect(first_result.created).toBe(true);
    expect(first_result.event.event_status).toBe('routed');
    expect(first_result.event_jobs).toHaveLength(1);
    expect(duplicate_result.created).toBe(false);
    expect(duplicate_result.event_jobs).toHaveLength(0);
    expect(jobs).toHaveLength(1);
  });

  it('claims ready jobs for one subject and blocks concurrent runs', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await enqueue_event_jobs(db, build_event_input(bootstrap.workspace_id, 'EvA'));
    await enqueue_event_jobs(db, build_event_input(bootstrap.workspace_id, 'EvB'));

    const claimed_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-a',
      now: new Date('2026-06-06T10:00:00.000Z'),
    });
    const blocked_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-b',
      now: new Date('2026-06-06T10:00:01.000Z'),
    });
    const claimed_events = await list_events_for_event_jobs(db, {
      workspace_id: bootstrap.workspace_id,
      event_jobs: claimed_jobs,
    });

    expect(claimed_jobs).toHaveLength(2);
    expect(claimed_events.map((event) => event.source_event_id)).toEqual(['EvA', 'EvB']);
    expect(claimed_jobs[0]).toMatchObject({
      job_status: 'running',
      locked_by: 'worker-a',
      attempt_count: 1,
    });
    expect(blocked_jobs).toHaveLength(0);
  });

  it('finds queued work that remains while a subject is locked', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await enqueue_event_jobs(db, build_event_input(bootstrap.workspace_id, 'EvRunning'));

    await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-a',
      now: new Date('2026-06-06T10:00:00.000Z'),
      limit: 1,
    });
    await enqueue_event_jobs(db, build_event_input(bootstrap.workspace_id, 'EvWaiting'));

    const blocked_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-b',
      now: new Date('2026-06-06T10:00:01.000Z'),
    });
    const next_job = await find_next_queued_event_job_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
    });

    expect(blocked_jobs).toHaveLength(0);
    expect(next_job).toMatchObject({
      job_status: 'queued',
      queue_key: queue_key(),
    });
  });

  it('skips locked subjects when claiming the next ready job globally', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const blocked_subject = 'test:subject:blocked';
    const ready_subject = 'test:subject:ready';
    await enqueue_event_jobs(
      db,
      build_event_input(bootstrap.workspace_id, 'EvBlockedA', blocked_subject),
    );
    await enqueue_event_jobs(
      db,
      build_event_input(bootstrap.workspace_id, 'EvBlockedB', blocked_subject),
    );
    await enqueue_event_jobs(
      db,
      build_event_input(bootstrap.workspace_id, 'EvReady', ready_subject),
    );

    await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: blocked_subject,
      worker_id: 'worker-a',
      now: new Date('2026-06-06T10:00:00.000Z'),
      limit: 1,
    });
    const next_jobs = await claim_next_ready_event_jobs(db, {
      workspace_id: bootstrap.workspace_id,
      worker_id: 'worker-b',
      now: new Date('2026-06-06T10:00:01.000Z'),
    });

    expect(next_jobs.map((job) => job.queue_key)).toEqual([ready_subject]);
  });

  it('keeps newer subject work behind a future barrier without blocking other subjects', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const blocked_subject = 'test:subject:delivery-retry';
    const unrelated_subject = 'test:subject:unrelated';
    const now = new Date('2026-06-06T10:00:00.000Z');
    const retry_time = new Date('2026-06-06T10:01:00.000Z');

    await enqueue_event_jobs(db, {
      ...build_agent_event_input(bootstrap.workspace_id, 'EvBarrier', blocked_subject, retry_time),
      event_jobs: [
        {
          job_handler: 'slack_agent_message',
          available_time: retry_time,
          metadata: { [event_job_queue_barrier_metadata_key]: true },
        },
      ],
    });
    await enqueue_event_jobs(
      db,
      build_agent_event_input(bootstrap.workspace_id, 'EvNewer', blocked_subject),
    );
    await enqueue_event_jobs(
      db,
      build_agent_event_input(bootstrap.workspace_id, 'EvUnrelated', unrelated_subject),
    );

    expect(
      await claim_ready_event_jobs_for_queue(db, {
        workspace_id: bootstrap.workspace_id,
        queue_key: blocked_subject,
        worker_id: 'worker-blocked',
        now,
      }),
    ).toEqual([]);

    const unrelated_jobs = await claim_next_ready_event_jobs(db, {
      workspace_id: bootstrap.workspace_id,
      worker_id: 'worker-unrelated',
      now,
    });
    expect(unrelated_jobs.map((job) => job.queue_key)).toEqual([unrelated_subject]);

    const resumed_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: blocked_subject,
      worker_id: 'worker-resumed',
      now: retry_time,
    });
    expect(resumed_jobs).toHaveLength(2);
  });

  it('lists distinct ready subjects and respects workspace admission', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const now = new Date('2026-06-06T10:00:00.000Z');
    const running_subject = 'test:subject:running';
    const ready_subject = 'test:subject:ready';

    await db
      .update(workspaces)
      .set({
        metadata: sql`${workspaces.metadata} || '{"max_concurrent_runs": 2}'::jsonb`,
        last_updated_time: now,
        last_updated_by: 'test',
      })
      .where(eq(workspaces.workspace_id, bootstrap.workspace_id));
    await Promise.all([
      enqueue_event_jobs(
        db,
        build_agent_event_input(bootstrap.workspace_id, 'EvRunning', running_subject),
      ),
      enqueue_event_jobs(
        db,
        build_agent_event_input(bootstrap.workspace_id, 'EvReadyA', ready_subject),
      ),
      enqueue_event_jobs(
        db,
        build_agent_event_input(bootstrap.workspace_id, 'EvReadyB', ready_subject),
      ),
      enqueue_event_jobs(
        db,
        build_agent_event_input(
          bootstrap.workspace_id,
          'EvFuture',
          'test:subject:future',
          new Date('2026-06-06T10:05:00.000Z'),
        ),
      ),
    ]);
    await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: running_subject,
      worker_id: 'worker-running',
      now,
    });

    const ready_subjects = await list_ready_event_job_queues(db, { limit: 10, now });

    expect(ready_subjects).toEqual([
      { workspace_id: bootstrap.workspace_id, queue_key: ready_subject },
    ]);

    await db
      .update(workspaces)
      .set({
        metadata: sql`${workspaces.metadata} || '{"max_concurrent_runs": 1}'::jsonb`,
        last_updated_time: now,
        last_updated_by: 'test',
      })
      .where(eq(workspaces.workspace_id, bootstrap.workspace_id));

    expect(await list_ready_event_job_queues(db, { limit: 10, now })).toEqual([]);
  });

  it('recovers expired jobs and saves handler results', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await enqueue_event_jobs(db, build_event_input(bootstrap.workspace_id, 'EvRetry'));

    const [claimed_job] = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-a',
      now: new Date('2026-06-06T10:00:00.000Z'),
      lock_milliseconds: 10,
    });
    if (!claimed_job) throw new Error('Expected one claimed job');

    const recovered_jobs = await recover_expired_event_jobs(db, {
      now: new Date('2026-06-06T10:01:00.000Z'),
    });
    const [reclaimed_job] = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-b',
      now: new Date('2026-06-06T10:01:00.000Z'),
    });
    if (!reclaimed_job) throw new Error('Expected one reclaimed job');

    const [done_job] = await save_event_job_result(db, {
      workspace_id: bootstrap.workspace_id,
      job_ids: [reclaimed_job.job_id],
      lock_token: token_of(reclaimed_job),
      result: { job_status: 'done', run_id: 'run_123', result_data: { ok: true } },
    });

    expect(recovered_jobs).toHaveLength(1);
    expect(recovered_jobs[0]).toMatchObject({
      job_status: 'queued',
      attempt_count: 0,
      interruption_count: 1,
      lock_token: null,
    });
    expect(reclaimed_job.attempt_count).toBe(1);
    expect(done_job).toMatchObject({
      job_status: 'done',
      locked_by: null,
      run_id: 'run_123',
      result_data: { ok: true },
    });
  });

  it('a requeue-to-wait returns the attempt it consumed so conflicts do not burn the dead-letter budget', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await enqueue_event_jobs(db, build_event_input(bootstrap.workspace_id, 'EvConflict'));

    const [claimed_job] = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-a',
      now: new Date('2026-06-06T10:00:00.000Z'),
    });
    if (!claimed_job) throw new Error('Expected one claimed job');
    expect(claimed_job.attempt_count).toBe(1);

    const retry_at = new Date('2026-06-06T10:00:05.000Z');
    const [requeued_job] = await save_event_job_result(db, {
      workspace_id: bootstrap.workspace_id,
      job_ids: [claimed_job.job_id],
      lock_token: token_of(claimed_job),
      result: { job_status: 'failed', retry_at },
    });

    expect(requeued_job).toMatchObject({ job_status: 'queued', attempt_count: 0 });
    expect(requeued_job?.available_time).toEqual(retry_at);
  });

  it('extends a held lease so a healthy long-running job is not reclaimed', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await enqueue_event_jobs(db, build_event_input(bootstrap.workspace_id, 'EvHeartbeat'));

    const [claimed_job] = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-a',
      now: new Date('2026-06-06T10:00:00.000Z'),
      lock_milliseconds: 10,
    });
    if (!claimed_job) throw new Error('Expected one claimed job');

    const extended = await extend_event_job_lock(db, {
      workspace_id: bootstrap.workspace_id,
      job_ids: [claimed_job.job_id],
      lock_token: token_of(claimed_job),
      now: new Date('2026-06-06T10:00:00.000Z'),
      lock_milliseconds: 600_000,
    });
    const foreign = await extend_event_job_lock(db, {
      workspace_id: bootstrap.workspace_id,
      job_ids: [claimed_job.job_id],
      lock_token: '00000000-0000-4000-8000-000000000000',
      now: new Date('2026-06-06T10:00:00.000Z'),
      lock_milliseconds: 600_000,
    });
    const recovered = await recover_expired_event_jobs(db, {
      now: new Date('2026-06-06T10:01:00.000Z'),
    });

    expect(extended).toHaveLength(1);
    expect(foreign).toHaveLength(0);
    expect(recovered).toHaveLength(0);
  });

  it('saves progress only for the worker that holds the job lease', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await enqueue_event_jobs(db, build_event_input(bootstrap.workspace_id, 'EvProgress'));
    const [claimed_job] = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-a',
    });
    if (!claimed_job) throw new Error('Expected one claimed job');
    const progress = { completed_unit_count: 6, total_unit_count: 20 };
    const job = {
      workspace_id: bootstrap.workspace_id,
      job_ids: [claimed_job.job_id],
      progress,
    };

    const saved = await save_event_job_progress(db, { ...job, lock_token: token_of(claimed_job) });
    const stale = await save_event_job_progress(db, {
      ...job,
      lock_token: '00000000-0000-4000-8000-000000000000',
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]?.result_data).toMatchObject({ progress });
    expect(stale).toHaveLength(0);
  });

  it('does not save stale results after another worker recovers the lock', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await enqueue_event_jobs(db, build_event_input(bootstrap.workspace_id, 'EvStale'));

    const [worker_a_job] = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-a',
      now: new Date('2026-06-06T10:00:00.000Z'),
      lock_milliseconds: 10,
    });
    if (!worker_a_job) throw new Error('Expected worker A claim');

    await recover_expired_event_jobs(db, {
      now: new Date('2026-06-06T10:01:00.000Z'),
    });
    const [worker_b_job] = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-b',
      now: new Date('2026-06-06T10:01:00.000Z'),
    });
    if (!worker_b_job) throw new Error('Expected worker B claim');

    const stale_results = await save_event_job_result(db, {
      workspace_id: bootstrap.workspace_id,
      job_ids: [worker_a_job.job_id],
      lock_token: token_of(worker_a_job),
      result: { job_status: 'done', run_id: 'stale_run' },
    });
    const current_job = await db.query.event_jobs.findFirst({
      where: eq(event_jobs.job_id, worker_b_job.job_id),
    });

    expect(stale_results).toHaveLength(0);
    expect(current_job).toMatchObject({
      job_status: 'running',
      locked_by: 'worker-b',
      run_id: null,
    });
  });

  it('does not attach a stale run id after another worker recovers the lock', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await enqueue_event_jobs(db, build_event_input(bootstrap.workspace_id, 'EvStaleRunId'));

    const [worker_a_job] = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-a',
      now: new Date('2026-06-06T10:00:00.000Z'),
      lock_milliseconds: 10,
    });
    if (!worker_a_job) throw new Error('Expected worker A claim');

    await recover_expired_event_jobs(db, {
      now: new Date('2026-06-06T10:01:00.000Z'),
    });
    const [worker_b_job] = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-b',
      now: new Date('2026-06-06T10:01:00.000Z'),
    });
    if (!worker_b_job) throw new Error('Expected worker B claim');

    const stale_updates = await set_event_jobs_run_id(db, {
      workspace_id: bootstrap.workspace_id,
      job_ids: [worker_a_job.job_id],
      lock_token: token_of(worker_a_job),
      run_id: 'run_stale',
    });
    const current_updates = await set_event_jobs_run_id(db, {
      workspace_id: bootstrap.workspace_id,
      job_ids: [worker_b_job.job_id],
      lock_token: token_of(worker_b_job),
      run_id: 'run_current',
    });

    expect(stale_updates).toHaveLength(0);
    expect(current_updates).toHaveLength(1);
    expect(current_updates[0]).toMatchObject({
      locked_by: 'worker-b',
      run_id: 'run_current',
    });
  });
});

describe('claiming a queue with jobs that run alone', () => {
  it.each([
    { kinds: ['shared', 'alone', 'shared'], claimed: ['q0'] },
    { kinds: ['alone', 'shared'], claimed: ['q0'] },
    { kinds: ['alone', 'alone'], claimed: ['q0'] },
    { kinds: ['shared', 'shared'], claimed: ['q0', 'q1'] },
  ])('claims $claimed from $kinds', async ({ kinds, claimed }) => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    for (const [index, kind] of kinds.entries()) {
      // biome-ignore lint/performance/noAwaitInLoops: the jobs must be created in this order.
      await enqueue_event_jobs(db, {
        ...build_event_input(bootstrap.workspace_id, `q${index}`),
        event_jobs: [
          {
            job_handler: 'test_handler',
            available_time: ready_time(),
            metadata: kind === 'alone' ? { claimed_alone: true } : {},
          },
        ],
      });
    }

    const claimed_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: queue_key(),
      worker_id: 'worker-a',
      now: new Date('2026-06-06T10:00:00.000Z'),
    });
    const claimed_events = await list_events_for_event_jobs(db, {
      workspace_id: bootstrap.workspace_id,
      event_jobs: claimed_jobs,
    });

    expect(claimed_events.map((event) => event.source_event_id).sort()).toEqual(claimed);
  });
});

function build_event_input(
  workspace_id: string,
  source_event_id: string,
  event_queue_key = queue_key(),
) {
  return {
    workspace_id,
    source: 'test',
    source_event_id,
    event_type: 'message',
    queue_key: event_queue_key,
    actor_key: 'user:test',
    event_body: { text: source_event_id },
    raw_payload: { id: source_event_id },
    event_jobs: [{ job_handler: 'test_handler', available_time: ready_time() }],
  };
}

function build_agent_event_input(
  workspace_id: string,
  source_event_id: string,
  event_queue_key: string,
  available_time = ready_time(),
) {
  return {
    ...build_event_input(workspace_id, source_event_id, event_queue_key),
    event_jobs: [{ job_handler: 'slack_agent_message', available_time }],
  };
}

function queue_key() {
  return 'test:subject:one';
}

function token_of(job: { lock_token: string | null }) {
  if (!job.lock_token) throw new Error('Expected a claimed job with a lock token');
  return job.lock_token;
}

function ready_time() {
  return new Date('2026-06-06T09:59:00.000Z');
}
