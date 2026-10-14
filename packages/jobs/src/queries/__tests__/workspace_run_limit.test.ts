import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { set_workspace_max_concurrent_runs } from '@coworker/core/db/queries/workspace_run_cap';
import { workspaces } from '@coworker/core/db/schema';
import { claim_next_ready_event_jobs, claim_ready_event_jobs_for_queue } from '@coworker/jobs';
import { NotFoundError, ValidationError } from '@coworker/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const actor_id = 'test:workspace_run_limit';
const claim_time = new Date('2026-06-06T10:00:00.000Z');

describe('workspace run limit', () => {
  it('skips a subject at the workspace run limit and moves to another workspace', async () => {
    const db = await create_test_database();
    const workspace_a_id = await create_workspace(db, 'run-limit-a', 1);
    const workspace_b_id = await create_workspace(db, 'run-limit-b', 1);

    await queue_job(db, {
      workspace_id: workspace_a_id,
      source_event_id: 'a-running',
      queue_key: 'slack:a:running',
      job_handler: 'slack_agent_message',
      available_time: new Date('2026-06-06T09:57:00.000Z'),
    });
    await claim_ready_event_jobs_for_queue(db, {
      workspace_id: workspace_a_id,
      queue_key: 'slack:a:running',
      worker_id: 'worker-running-a',
      now: claim_time,
    });
    await queue_job(db, {
      workspace_id: workspace_a_id,
      source_event_id: 'a-next',
      queue_key: 'slack:a:next',
      job_handler: 'slack_agent_message',
      available_time: new Date('2026-06-06T09:58:00.000Z'),
    });
    await queue_job(db, {
      workspace_id: workspace_b_id,
      source_event_id: 'b-next',
      queue_key: 'slack:b:next',
      job_handler: 'slack_agent_message',
      available_time: new Date('2026-06-06T09:59:00.000Z'),
    });

    const capped_workspace_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: workspace_a_id,
      queue_key: 'slack:a:next',
      worker_id: 'worker-capped-a',
      now: new Date('2026-06-06T10:00:01.000Z'),
    });
    const next_workspace_jobs = await claim_next_ready_event_jobs(db, {
      worker_id: 'worker-next',
      now: new Date('2026-06-06T10:00:01.000Z'),
    });

    expect(capped_workspace_jobs).toHaveLength(0);
    expect(next_workspace_jobs).toHaveLength(1);
    expect(next_workspace_jobs[0]).toMatchObject({
      workspace_id: workspace_b_id,
      queue_key: 'slack:b:next',
      job_handler: 'slack_agent_message',
    });
  });

  it('keeps concurrent generic claims fanned out across ready subjects', async () => {
    const db = await create_test_database();
    const subject_count = 12;

    for (let subject_index = 0; subject_index < subject_count; subject_index += 1) {
      const workspace_id = await create_workspace(db, `run-fanout-${subject_index}`, 1);
      await queue_job(db, {
        workspace_id,
        source_event_id: `fanout-${subject_index}`,
        queue_key: `slack:fanout:${subject_index}`,
        job_handler: 'slack_agent_message',
      });
    }

    const claimed_batches = await Promise.all(
      Array.from({ length: subject_count }, (_, worker_index) =>
        claim_next_ready_event_jobs(db, {
          worker_id: `worker-fanout-${worker_index}`,
          now: claim_time,
        }),
      ),
    );
    const claimed_jobs = claimed_batches.flat();

    expect(claimed_jobs).toHaveLength(subject_count);
    expect(new Set(claimed_jobs.map((job) => job.queue_key)).size).toBe(subject_count);
  });

  it('does not cap memory discovery jobs that do not start agent runs', async () => {
    const db = await create_test_database();
    const workspace_id = await create_workspace(db, 'run-limit-memory', 1);

    await queue_job(db, {
      workspace_id,
      source_event_id: 'memory-running',
      queue_key: 'slack:crawl:running',
      job_handler: 'slack_agent_message',
    });
    await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key: 'slack:crawl:running',
      worker_id: 'worker-running-crawl',
      now: claim_time,
    });
    await queue_job(db, {
      workspace_id,
      source_event_id: 'crawl-next',
      queue_key: 'brain:crawl',
      job_handler: 'brain_source_crawl',
    });

    const crawl_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key: 'brain:crawl',
      worker_id: 'worker-crawl',
      now: new Date('2026-06-06T10:00:01.000Z'),
    });

    expect(crawl_jobs).toHaveLength(1);
    expect(crawl_jobs[0]).toMatchObject({
      queue_key: 'brain:crawl',
      job_handler: 'brain_source_crawl',
    });
  });

  it('does not let a leading maintenance job pull a later agent run past the cap', async () => {
    const db = await create_test_database();
    const workspace_id = await create_workspace(db, 'run-limit-mixed-subject', 1);

    await queue_and_claim_run(db, workspace_id, 'mixed-running', 'slack:mixed:running');
    await queue_job(db, {
      workspace_id,
      source_event_id: 'mixed-maintenance',
      queue_key: 'slack:mixed:next',
      job_handler: 'brain_source_crawl',
      available_time: new Date('2026-06-06T09:58:00.000Z'),
    });
    await queue_job(db, {
      workspace_id,
      source_event_id: 'mixed-agent-run',
      queue_key: 'slack:mixed:next',
      job_handler: 'slack_agent_message',
      available_time: new Date('2026-06-06T09:59:00.000Z'),
    });

    const mixed_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key: 'slack:mixed:next',
      worker_id: 'worker-mixed-next',
      now: claim_time,
    });

    expect(mixed_jobs).toHaveLength(0);
  });

  it('uses workspace metadata to raise the concurrent run cap', async () => {
    const db = await create_test_database();
    const workspace_id = await create_workspace(db, 'run-limit-override', 3);

    await queue_and_claim_run(db, workspace_id, 'override-running-1', 'slack:override:one');
    await queue_and_claim_run(db, workspace_id, 'override-running-2', 'slack:override:two');
    await queue_job(db, {
      workspace_id,
      source_event_id: 'override-next',
      queue_key: 'slack:override:next',
      job_handler: 'slack_agent_message',
    });

    const claimed_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key: 'slack:override:next',
      worker_id: 'worker-override',
      now: new Date('2026-06-06T10:00:01.000Z'),
    });

    expect(claimed_jobs).toHaveLength(1);
    expect(claimed_jobs[0]).toMatchObject({
      queue_key: 'slack:override:next',
      job_handler: 'slack_agent_message',
    });
  });

  it('falls back to the configured limit for invalid workspace overrides', async () => {
    const db = await create_test_database();
    const invalid_limits: unknown[] = [
      'not-a-number',
      0,
      -1,
      '2147483648',
      '9'.repeat(40),
      '1',
      1.5,
      2147483648,
      true,
      { value: 1 },
    ];

    for (const [invalid_limit_index, invalid_limit] of invalid_limits.entries()) {
      const workspace_id = await create_workspace(
        db,
        `run-limit-invalid-${invalid_limit_index}`,
        invalid_limit,
      );

      for (let run_number = 1; run_number <= env.WORKSPACE_MAX_CONCURRENT_RUNS; run_number += 1) {
        const claimed_jobs = await queue_and_claim_run(
          db,
          workspace_id,
          `invalid-${invalid_limit_index}-running-${run_number}`,
          `slack:invalid:${invalid_limit_index}:${run_number}`,
        );
        expect(claimed_jobs).toHaveLength(1);
      }

      const next_queue_key = `slack:invalid:${invalid_limit_index}:next`;
      await queue_job(db, {
        workspace_id,
        source_event_id: `invalid-${invalid_limit_index}-next`,
        queue_key: next_queue_key,
        job_handler: 'slack_agent_message',
      });
      const next_jobs = await claim_ready_event_jobs_for_queue(db, {
        workspace_id,
        queue_key: next_queue_key,
        worker_id: `worker-invalid-${invalid_limit_index}-next`,
        now: new Date('2026-06-06T10:00:01.000Z'),
      });

      expect(next_jobs).toHaveLength(0);
    }
  });

  it('writes a valid cap the claim honors and rejects every invalid one', async () => {
    const db = await create_test_database();
    const workspace_id = await create_workspace(db, 'run-limit-write-path', undefined);

    for (const invalid of ['3', 'garbage', 0, -1, 1.5, 1001, null, { value: 3 }]) {
      await expect(
        set_workspace_max_concurrent_runs(db, {
          workspace_id,
          max_concurrent_runs: invalid,
          actor_id,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      set_workspace_max_concurrent_runs(db, {
        workspace_id: 'ws_missing',
        max_concurrent_runs: 3,
        actor_id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const saved = await set_workspace_max_concurrent_runs(db, {
      workspace_id,
      max_concurrent_runs: 3,
      actor_id,
    });

    const claimed_counts: number[] = [];
    for (let run_number = 1; run_number <= 4; run_number += 1) {
      const jobs = await queue_and_claim_run(
        db,
        workspace_id,
        `write-path-${run_number}`,
        `slack:write-path:${run_number}`,
      );
      claimed_counts.push(jobs.length);
    }
    const [workspace] = await db
      .select({ metadata: workspaces.metadata })
      .from(workspaces)
      .where(eq(workspaces.workspace_id, workspace_id));

    expect(saved).toEqual({ workspace_id, max_concurrent_runs: 3 });
    expect(workspace?.metadata).toEqual({ max_concurrent_runs: 3 });
    expect(claimed_counts).toEqual([1, 1, 1, 0]);
  });

  it('counts one coalesced subject batch as one concurrent run', async () => {
    const db = await create_test_database();
    const workspace_id = await create_workspace(db, 'run-limit-batch', 2);
    const batched_queue_key = 'slack:batch:one';

    for (let job_number = 1; job_number <= 6; job_number += 1) {
      await queue_job(db, {
        workspace_id,
        source_event_id: `batch-running-${job_number}`,
        queue_key: batched_queue_key,
        job_handler: 'slack_agent_message',
      });
    }
    const batched_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key: batched_queue_key,
      worker_id: 'worker-batched-subject',
      now: claim_time,
    });
    await queue_job(db, {
      workspace_id,
      source_event_id: 'batch-next-subject',
      queue_key: 'slack:batch:two',
      job_handler: 'slack_agent_message',
    });

    const second_subject_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key: 'slack:batch:two',
      worker_id: 'worker-second-subject',
      now: new Date('2026-06-06T10:00:01.000Z'),
    });

    expect(batched_jobs).toHaveLength(6);
    expect(second_subject_jobs).toHaveLength(1);
  });

  it('does not count expired locks toward the workspace run limit', async () => {
    const db = await create_test_database();
    const workspace_id = await create_workspace(db, 'run-limit-expired', 1);

    await queue_job(db, {
      workspace_id,
      source_event_id: 'expired-running',
      queue_key: 'slack:expired:running',
      job_handler: 'slack_agent_message',
    });
    await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key: 'slack:expired:running',
      worker_id: 'worker-expired',
      now: claim_time,
      lock_milliseconds: 10,
    });
    await queue_job(db, {
      workspace_id,
      source_event_id: 'expired-next',
      queue_key: 'slack:expired:next',
      job_handler: 'slack_agent_message',
    });

    const claimed_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key: 'slack:expired:next',
      worker_id: 'worker-after-expiry',
      now: new Date('2026-06-06T10:01:00.000Z'),
    });

    expect(claimed_jobs).toHaveLength(1);
    expect(claimed_jobs[0]).toMatchObject({
      queue_key: 'slack:expired:next',
      job_handler: 'slack_agent_message',
    });
  });

  it('never holds back a web chat message, and never counts one against background work', async () => {
    const db = await create_test_database();
    const workspace_id = await create_workspace(db, 'run-limit-chat', 1);
    const later = new Date('2026-06-06T10:00:01.000Z');

    expect(await queue_and_claim_run(db, workspace_id, 'bg-1', 'slack:chat:bg-1')).toHaveLength(1);
    await queue_job(db, {
      workspace_id,
      source_event_id: 'chat-1',
      queue_key: 'session:ses_chat_1',
      job_handler: 'session_agent_message',
    });
    const chat_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key: 'session:ses_chat_1',
      worker_id: 'worker-chat-1',
      now: later,
    });
    expect(chat_jobs).toHaveLength(1);

    await queue_job(db, {
      workspace_id,
      source_event_id: 'bg-2',
      queue_key: 'slack:chat:bg-2',
      job_handler: 'slack_agent_message',
    });
    const held_background = await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key: 'slack:chat:bg-2',
      worker_id: 'worker-bg-2',
      now: later,
    });
    expect(held_background).toHaveLength(0);
  });

  it('does not let a running chat message use up the cap for background work', async () => {
    const db = await create_test_database();
    const workspace_id = await create_workspace(db, 'run-limit-chat-first', 1);
    const later = new Date('2026-06-06T10:00:01.000Z');

    await queue_job(db, {
      workspace_id,
      source_event_id: 'chat-first',
      queue_key: 'session:ses_chat_first',
      job_handler: 'session_agent_message',
    });
    expect(
      await claim_ready_event_jobs_for_queue(db, {
        workspace_id,
        queue_key: 'session:ses_chat_first',
        worker_id: 'worker-chat-first',
        now: claim_time,
      }),
    ).toHaveLength(1);
    await queue_job(db, {
      workspace_id,
      source_event_id: 'bg-after-chat',
      queue_key: 'slack:chat:bg-after-chat',
      job_handler: 'slack_agent_message',
    });

    const background = await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key: 'slack:chat:bg-after-chat',
      worker_id: 'worker-bg-after-chat',
      now: later,
    });
    expect(background).toHaveLength(1);
  });
});

async function create_workspace(
  db: Database,
  workspace_slug: string,
  max_concurrent_runs: unknown,
) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      workspace_name: workspace_slug,
      workspace_slug,
      workspace_status: 'active',
      metadata: max_concurrent_runs === undefined ? {} : { max_concurrent_runs },
      created_by: actor_id,
      last_updated_by: actor_id,
    })
    .returning({ workspace_id: workspaces.workspace_id });
  if (!workspace) throw new Error(`Workspace insert failed for ${workspace_slug}`);
  return workspace.workspace_id;
}

async function queue_and_claim_run(
  db: Database,
  workspace_id: string,
  source_event_id: string,
  queue_key: string,
) {
  await queue_job(db, {
    workspace_id,
    source_event_id,
    queue_key,
    job_handler: 'slack_agent_message',
  });
  return claim_ready_event_jobs_for_queue(db, {
    workspace_id,
    queue_key,
    worker_id: `worker-${source_event_id}`,
    now: claim_time,
  });
}

async function queue_job(
  db: Database,
  input: {
    workspace_id: string;
    source_event_id: string;
    queue_key: string;
    job_handler: string;
    available_time?: Date;
  },
) {
  return enqueue_event_jobs(db, {
    workspace_id: input.workspace_id,
    source: 'test:workspace_run_limit',
    source_event_id: input.source_event_id,
    event_type: 'message',
    queue_key: input.queue_key,
    actor_key: 'user:test',
    event_body: { text: input.source_event_id },
    raw_payload: { id: input.source_event_id },
    event_jobs: [
      {
        job_handler: input.job_handler,
        available_time: input.available_time ?? new Date('2026-06-06T09:59:00.000Z'),
      },
    ],
  });
}
