import type { event_jobs } from '@coworker/core';
import { create_serial_operation_queue } from '@coworker/jobs/event_job_lease';
import { group_event_jobs_by_handler } from '@coworker/jobs/event_job_runner';
import { describe, expect, it } from 'vitest';

type EventJob = typeof event_jobs.$inferSelect;

describe('event job handler grouping', () => {
  it('serializes lease and result writes even when callers overlap', async () => {
    const run_exclusively = create_serial_operation_queue();
    const operations: string[] = [];
    let release_first: (() => void) | undefined;
    const first_gate = new Promise<void>((resolve) => {
      release_first = resolve;
    });

    const first = run_exclusively(async () => {
      operations.push('heartbeat_started');
      await first_gate;
      operations.push('heartbeat_finished');
    });
    const second = run_exclusively(async () => {
      operations.push('result_saved');
    });
    await Promise.resolve();

    expect(operations).toEqual(['heartbeat_started']);
    release_first?.();
    await Promise.all([first, second]);
    expect(operations).toEqual(['heartbeat_started', 'heartbeat_finished', 'result_saved']);
  });

  it('keeps fresh work separate from each previously started run', () => {
    const groups = group_event_jobs_by_handler([
      event_job('job_replay_a_1', 'run_a'),
      event_job('job_fresh_1', null),
      event_job('job_replay_b', 'run_b'),
      event_job('job_replay_a_2', 'run_a'),
      event_job('job_fresh_2', null),
    ]);

    expect(groups.map((group) => group.event_jobs.map((job) => job.job_id))).toEqual([
      ['job_fresh_1', 'job_fresh_2'],
      ['job_replay_a_1', 'job_replay_a_2'],
      ['job_replay_b'],
    ]);
  });

  it('runs handler groups in oldest-job order without handler-specific priority', () => {
    const groups = group_event_jobs_by_handler([
      event_job('job_newer', null, 'connection_resume', 2),
      event_job('job_older', null, 'slack_agent_message', 1),
    ]);

    expect(groups.map((group) => group.job_handler)).toEqual([
      'slack_agent_message',
      'connection_resume',
    ]);
  });
});

function event_job(
  job_id: string,
  run_id: string | null,
  job_handler = 'slack_agent_message',
  created_offset_ms = 0,
): EventJob {
  const now = new Date('2026-07-11T00:00:00.000Z');
  return {
    job_id,
    workspace_id: 'ws_test',
    event_id: `evt_${job_id}`,
    queue_key: 'session:test',
    job_handler,
    job_status: 'running',
    awaits_event_type: null,
    awaits_queue_key: null,
    awaits_until_time: null,
    available_time: now,
    locked_by: 'worker_test',
    locked_until: now,
    lock_token: '00000000-0000-4000-8000-000000000001',
    wake_sent_time: null,
    attempt_count: 1,
    interruption_count: 0,
    run_id,
    result_data: {},
    error_data: {},
    metadata: {},
    created_time: new Date(now.getTime() + created_offset_ms),
    last_updated_time: now,
    created_by: 'system:test',
    last_updated_by: 'system:test',
  };
}
