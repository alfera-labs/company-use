import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { agent_heartbeat_job_handler } from '@coworker/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue_and_run_event_jobs = vi.fn();
vi.mock('@coworker/jobs/event_job_runner', () => ({ queue_and_run_event_jobs }));

const { fire_due_schedule_triggers } = await import(
  '@runtime-platform/events/schedule_trigger_loop'
);

type Db = Awaited<ReturnType<typeof create_test_database>>;
type Bootstrap = Awaited<ReturnType<typeof bootstrap_default_workspace>>;

const now = new Date('2026-07-11T19:10:00.000Z');

describe('fire_due_schedule_triggers', () => {
  beforeEach(() => {
    queue_and_run_event_jobs.mockReset();
    queue_and_run_event_jobs.mockResolvedValue({ created: true, event_jobs: [] });
  });

  it('fires a one-time task whose instant has passed, keyed to that instant', async () => {
    const fixture = await create_fixture();
    const trigger = await create_one_time_task(fixture, '2026-07-11T19:07:00.000Z');

    const result = await fire_due_schedule_triggers(fixture.db, now);

    expect(result).toEqual({ due: 1, fired: 1 });
    const event = queue_and_run_event_jobs.mock.calls[0]?.[1];
    expect(event).toMatchObject({
      event_type: 'trigger.fired',
      source_event_id: `${trigger.trigger_id}:2026-07-11T19:07:00.000Z`,
      event_body: { trigger_id: trigger.trigger_id, instruction: 'Summarize the article.' },
    });
  });

  it('stores the instant of a future one-time task without firing it', async () => {
    const fixture = await create_fixture();
    const trigger = await create_one_time_task(fixture, '2026-07-11T20:00:00.000Z');

    const result = await fire_due_schedule_triggers(fixture.db, now);

    expect(result).toEqual({ due: 1, fired: 0 });
    expect(queue_and_run_event_jobs).not.toHaveBeenCalled();
    const stored = await get_trigger_by_id(fixture.db, trigger.trigger_id);
    expect(stored?.next_run_time).toEqual(new Date('2026-07-11T20:00:00.000Z'));
  });

  it('initializes a recurring trigger clock without firing, then fires when due', async () => {
    const fixture = await create_fixture();
    const trigger = await create_recurring_trigger(fixture);

    const first = await fire_due_schedule_triggers(fixture.db, now);
    expect(first).toEqual({ due: 1, fired: 0 });
    expect(queue_and_run_event_jobs).not.toHaveBeenCalled();
    const initialized = await get_trigger_by_id(fixture.db, trigger.trigger_id);
    const initialized_next_run_time = initialized?.next_run_time;
    if (!initialized_next_run_time) throw new Error('the recurring trigger never got a clock');
    expect(initialized_next_run_time.getTime()).toBeGreaterThan(now.getTime());

    const later = new Date(initialized_next_run_time.getTime() + 60_000);
    const second = await fire_due_schedule_triggers(fixture.db, later);
    expect(second).toEqual({ due: 1, fired: 1 });
    const advanced = await get_trigger_by_id(fixture.db, trigger.trigger_id);
    expect(advanced?.next_run_time?.getTime()).toBeGreaterThan(later.getTime());
    expect(advanced?.last_run_time).toEqual(later);
  });

  it('counts a deduped refire as not fired', async () => {
    const fixture = await create_fixture();
    await create_one_time_task(fixture, '2026-07-11T19:07:00.000Z');
    queue_and_run_event_jobs.mockResolvedValue({ created: false, event_jobs: [] });

    const result = await fire_due_schedule_triggers(fixture.db, now);

    expect(result).toEqual({ due: 1, fired: 0 });
  });
});

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  return { db, bootstrap };
}

function create_one_time_task(fixture: { db: Db; bootstrap: Bootstrap }, run_once_at: string) {
  return create_trigger(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    agent_id: fixture.bootstrap.agent_id,
    trigger_name: 'Article summary to Notion',
    trigger_type: 'schedule',
    schedule_expression: '7 19 11 7 *',
    trigger_config: {
      starts_job_handler: 'run_scheduled_agent_task',
      run_once_at,
      timezone: 'Europe/Amsterdam',
      job_input: { instruction: 'Summarize the article.' },
    },
    actor_id: fixture.bootstrap.user_id,
  });
}

function create_recurring_trigger(fixture: { db: Db; bootstrap: Bootstrap }) {
  return create_trigger(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    agent_id: fixture.bootstrap.agent_id,
    trigger_name: 'Agent scout',
    trigger_type: 'schedule',
    schedule_expression: '1 8,11,14,17 * * 1-5',
    trigger_config: {
      starts_job_handler: agent_heartbeat_job_handler,
      timezone: 'Europe/Amsterdam',
    },
    actor_id: fixture.bootstrap.user_id,
  });
}
