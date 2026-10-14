import { create_agent_scheduled_task } from '@api/services/triggers';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import { set_user_timezone } from '@coworker/core/db/queries/user_timezone';
import { fire_due_schedule_triggers } from '@runtime-platform/events/schedule_trigger_loop';
import { describe, expect, it } from 'vitest';

type Database = Awaited<ReturnType<typeof create_test_database>>;
type Person = Awaited<ReturnType<typeof bootstrap_default_workspace>>;

const monday_noon_utc = new Date('2026-01-12T12:00:00.000Z');

describe('a scheduled task the coworker makes for a person', () => {
  it('runs at 9:00 for a person east of UTC', async () => {
    const { db, person } = await create_person_in('Asia/Tokyo');

    const task = await create_weekday_task_at_nine(db, person);
    const next_run_time = await read_next_run_time_after(db, task.trigger_id, monday_noon_utc);

    expect(task.trigger_config.timezone).toBe('Asia/Tokyo');
    expect(next_run_time).toEqual(new Date(`2026-01-13T00:${stored_minute(task)}:00.000Z`));
  });

  it('runs at 9:00 for a person west of UTC', async () => {
    const { db, person } = await create_person_in('America/Los_Angeles');

    const task = await create_weekday_task_at_nine(db, person);
    const next_run_time = await read_next_run_time_after(db, task.trigger_id, monday_noon_utc);

    expect(task.trigger_config.timezone).toBe('America/Los_Angeles');
    expect(next_run_time).toEqual(new Date(`2026-01-12T17:${stored_minute(task)}:00.000Z`));
  });

  it('stays at 9:00 when the clocks change, because the name is stored and not an offset', async () => {
    const before = await create_person_in('Europe/Rome');
    const after = await create_person_in('Europe/Rome');

    const summer_task = await create_weekday_task_at_nine(before.db, before.person);
    const winter_task = await create_weekday_task_at_nine(after.db, after.person);
    const last_summer_run = await read_next_run_time_after(
      before.db,
      summer_task.trigger_id,
      new Date('2026-10-22T12:00:00.000Z'),
    );
    const first_winter_run = await read_next_run_time_after(
      after.db,
      winter_task.trigger_id,
      new Date('2026-10-23T12:00:00.000Z'),
    );

    expect(summer_task.trigger_config.timezone).toBe('Europe/Rome');
    expect(last_summer_run).toEqual(
      new Date(`2026-10-23T07:${stored_minute(summer_task)}:00.000Z`),
    );
    expect(first_winter_run).toEqual(
      new Date(`2026-10-26T08:${stored_minute(winter_task)}:00.000Z`),
    );
  });

  it('keeps the time zone the tool names over the time zone of the person', async () => {
    const { db, person } = await create_person_in('Asia/Tokyo');

    const task = await create_weekday_task_at_nine(db, person, 'Europe/Rome');

    expect(task.trigger_config.timezone).toBe('Europe/Rome');
  });

  it('uses UTC when the person has no time zone and the workspace has no Slack', async () => {
    const db = await create_test_database();
    const person = await bootstrap_default_workspace(db);

    const task = await create_weekday_task_at_nine(db, person);

    expect(task.trigger_config.timezone).toBe('UTC');
  });
});

async function create_person_in(timezone: string) {
  const db = await create_test_database();
  const person = await bootstrap_default_workspace(db);
  await set_user_timezone(db, { user_id: person.user_id, timezone, actor_id: person.user_id });
  return { db, person };
}

function create_weekday_task_at_nine(db: Database, person: Person, timezone?: string) {
  return create_agent_scheduled_task(db, {
    workspace_id: person.workspace_id,
    agent_id: person.agent_id,
    task_name: 'Morning plan',
    instruction: 'Write the plan for the day.',
    schedule_expression: '0 9 * * 1-5',
    ...(timezone ? { timezone } : {}),
    actor_id: person.user_id,
  });
}

async function read_next_run_time_after(db: Database, trigger_id: string, after: Date) {
  await fire_due_schedule_triggers(db, after);
  return (await get_trigger_by_id(db, trigger_id))?.next_run_time;
}

function stored_minute(task: { schedule_expression: string | null }) {
  const minute = Number(task.schedule_expression?.split(' ')[0]);
  expect(minute).toBeLessThan(5);
  return String(minute).padStart(2, '0');
}
