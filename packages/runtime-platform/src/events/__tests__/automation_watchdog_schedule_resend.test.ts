import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { automations, events, triggers } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cron_schedule = {
  supports_run_once: true,
  set_schedule: vi.fn(async (_schedule: { trigger_id: string }) => {}),
  pause_schedule: vi.fn(async () => {}),
  delete_schedule: vi.fn(async () => {}),
};
vi.mock('@api/services/scheduling/cron_schedule', () => ({
  get_cron_schedule: async () => cron_schedule,
}));

const { run_automation_watchdog_job } = await import(
  '@runtime-platform/events/automation_watchdog_job'
);

type Db = Awaited<ReturnType<typeof create_test_database>>;

const now = new Date('2026-09-15T09:00:00Z');
const an_hour_ago = new Date('2026-09-15T08:00:00Z');
const two_minutes_ago = new Date('2026-09-15T08:58:00Z');

let db: Db;
let workspace_id: string;
let agent_id: string;
let user_id: string;
let fired_event: typeof events.$inferSelect;

beforeEach(async () => {
  cron_schedule.set_schedule.mockReset();
  db = await create_test_database();
  ({ workspace_id, agent_id, user_id } = await bootstrap_default_workspace(db));
  await db.insert(automations).values({
    automation_id: 'atm_monday_report',
    workspace_id,
    agent_id,
    automation_name: 'Monday report',
    automation_status: 'enabled',
    instruction: 'Write the report.',
    run_policy: { subject_from: 'thread_id', when_a_run_is_already_going: 'wait_for_it_to_finish' },
    conditions: [],
    judge: null,
    uses_tools: { apps: [] },
    created_via: 'user',
    created_by: user_id,
    last_updated_by: user_id,
  });
  const watchdog = await create_trigger(db, {
    workspace_id,
    agent_id,
    trigger_name: 'Automation watchdog',
    trigger_type: 'schedule',
    schedule_expression: '3,33 * * * *',
    trigger_config: { starts_job_handler: 'run_automation_watchdog' },
    trigger_source: { kind: 'system', source: 'test', purpose: 'automation_watchdog' },
    actor_id: user_id,
  });
  const [row] = await db
    .insert(events)
    .values({
      event_id: 'evt_watchdog_fire',
      workspace_id,
      source: 'trigger',
      source_event_id: `${watchdog.trigger_id}:2026-09-15T09:00`,
      event_type: 'trigger.fired',
      queue_key: `trigger:${watchdog.trigger_id}`,
      actor_key: 'system:trigger',
      event_body: { trigger_id: watchdog.trigger_id },
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    })
    .returning();
  if (!row) throw new Error('the fire event was not seeded');
  fired_event = row;
});

async function seed_schedule_ear(changed_at: Date, trigger_status: 'enabled' | 'disabled') {
  const trigger = await create_trigger(db, {
    workspace_id,
    agent_id,
    automation_id: 'atm_monday_report',
    trigger_name: 'Every Monday at 9',
    trigger_type: 'schedule',
    trigger_status,
    schedule_expression: '0 9 * * 1',
    actor_id: user_id,
  });
  await db
    .update(triggers)
    .set({ last_updated_time: changed_at })
    .where(eq(triggers.trigger_id, trigger.trigger_id));
  return trigger.trigger_id;
}

function run_watchdog() {
  return run_automation_watchdog_job({ db, workspace_id, events: [fired_event], now });
}

function sent_trigger_ids() {
  return cron_schedule.set_schedule.mock.calls.map(([schedule]) => schedule.trigger_id);
}

describe('the watchdog sends a schedule the crash never sent', () => {
  it('sends it once, then leaves it alone until it changes again', async () => {
    const trigger_id = await seed_schedule_ear(an_hour_ago, 'enabled');

    const first = await run_watchdog();
    expect(sent_trigger_ids()).toEqual([trigger_id]);
    expect(first.result_data).toMatchObject({ schedules_resent: [trigger_id] });

    await run_watchdog();
    expect(sent_trigger_ids()).toEqual([trigger_id]);
  });

  it('waits out the grace so it never races the request that is still sending', async () => {
    await seed_schedule_ear(two_minutes_ago, 'enabled');
    await run_watchdog();
    expect(sent_trigger_ids()).toEqual([]);
  });

  it('never revives a paused schedule', async () => {
    await seed_schedule_ear(an_hour_ago, 'disabled');
    await run_watchdog();
    expect(sent_trigger_ids()).toEqual([]);
  });

  it('tries again next tick when the scheduler is down', async () => {
    const trigger_id = await seed_schedule_ear(an_hour_ago, 'enabled');
    cron_schedule.set_schedule.mockRejectedValueOnce(new Error('scheduler unavailable'));

    const first = await run_watchdog();
    expect(first.result_data).toMatchObject({ schedules_resent: [] });

    await run_watchdog();
    expect(sent_trigger_ids()).toEqual([trigger_id, trigger_id]);
  });
});
