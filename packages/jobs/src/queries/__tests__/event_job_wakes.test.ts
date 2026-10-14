import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import {
  claim_ready_event_jobs_for_queue,
  list_queued_jobs_with_stale_wake,
  mark_wake_sent,
} from '@coworker/jobs';
import { describe, expect, it } from 'vitest';

const now = new Date('2026-06-06T10:00:00.000Z');
const seconds_ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe('doorbell bookkeeping', () => {
  it('lists ready queued jobs whose ring is old, or that were never rung and waited as long', async () => {
    const db = await create_test_database();
    const { workspace_id } = await bootstrap_default_workspace(db);
    const job_id = async (queue_key: string, available_time = seconds_ago(120)) => {
      const queued = await enqueue_event_jobs(db, {
        workspace_id,
        source: 'test:wakes',
        source_event_id: queue_key,
        event_type: 'message',
        queue_key,
        actor_key: 'user:test',
        event_jobs: [{ job_handler: 'test_handler', available_time }],
      });
      const id = queued.event_jobs[0]?.job_id;
      if (!id) throw new Error('Expected one queued job');
      return id;
    };
    const stale = await job_id('queue:stale');
    const fresh = await job_id('queue:fresh');
    const never_rung = await job_id('queue:never-rung');
    const never_rung_just_ready = await job_id('queue:never-rung-fresh', seconds_ago(5));
    const claimed = await job_id('queue:claimed');
    const not_ready = await job_id('queue:not-ready', new Date(now.getTime() + 60_000));

    await mark_wake_sent(db, {
      workspace_id,
      job_ids: [stale, claimed, not_ready],
      now: seconds_ago(60),
    });
    await mark_wake_sent(db, { workspace_id, job_ids: [fresh], now: seconds_ago(5) });
    await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key: 'queue:claimed',
      worker_id: 'worker-a',
      now,
    });
    const late_ring = await mark_wake_sent(db, { workspace_id, job_ids: [claimed], now });

    const listed = await list_queued_jobs_with_stale_wake(db, {
      older_than_seconds: 30,
      limit: 10,
      now,
    });

    expect(late_ring).toEqual([]);
    expect(listed).toEqual([
      { job_id: never_rung, workspace_id, queue_key: 'queue:never-rung', wake_sent_time: null },
      { job_id: stale, workspace_id, queue_key: 'queue:stale', wake_sent_time: seconds_ago(60) },
    ]);
    expect(listed.map((job) => job.job_id)).not.toContain(never_rung_just_ready);
  });
});
