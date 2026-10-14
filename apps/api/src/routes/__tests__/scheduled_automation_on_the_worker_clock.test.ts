import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { event_jobs } from '@coworker/core/db/schema';
import { fire_due_schedule_triggers } from '@runtime-platform/events/schedule_trigger_loop';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const every_morning = {
  automation_name: 'Morning report',
  instruction: 'Write the morning report.',
  triggers: [{ kind: 'schedule', cron: '0 9 * * *', timezone: 'UTC' }],
};

async function create_scheduled_automation() {
  const db = await create_test_database();
  const identity = await bootstrap_default_workspace(db);
  const app = create_app(db);
  const response = await app.request('/v1/automations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(every_morning),
  });
  const created = (await response.json()).data;
  return { db, identity, app, status: response.status, automation: created.automation };
}

async function read_fires(app: ReturnType<typeof create_app>, automation_id: string) {
  const response = await app.request(`/v1/automations/${automation_id}/fires`);
  return (await response.json()).data.items;
}

async function list_automation_jobs(
  fixture: Awaited<ReturnType<typeof create_scheduled_automation>>,
) {
  return fixture.db.query.event_jobs.findMany({
    where: and(
      eq(event_jobs.workspace_id, fixture.identity.workspace_id),
      eq(event_jobs.job_handler, 'run_automation'),
    ),
  });
}

describe('a scheduled automation on an install with no cloud scheduler', () => {
  it('is saved live, as a schedule trigger that starts the automation job', async () => {
    const fixture = await create_scheduled_automation();
    const triggers = await list_automation_triggers(fixture.db, {
      workspace_id: fixture.identity.workspace_id,
      automation_id: fixture.automation.automation_id,
    });

    expect(fixture.status).toBe(201);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      trigger_type: 'schedule',
      trigger_status: 'enabled',
      schedule_expression: '0 9 * * *',
      trigger_config: { starts_job_handler: 'run_automation', timezone: 'UTC' },
    });
  });

  it('is fired by the clock tick of the worker, once, and the fire is in its run history', async () => {
    const fixture = await create_scheduled_automation();
    const automation_id = fixture.automation.automation_id;

    await fire_due_schedule_triggers(fixture.db, new Date('2026-10-20T08:30:00.000Z'));
    const before_nine = await list_automation_jobs(fixture);
    await fire_due_schedule_triggers(fixture.db, new Date('2026-10-20T09:00:00.000Z'));
    await fire_due_schedule_triggers(fixture.db, new Date('2026-10-20T09:00:15.000Z'));
    const jobs = await list_automation_jobs(fixture);
    const fires = await read_fires(fixture.app, automation_id);

    expect(before_nine).toEqual([]);
    expect(jobs.map((job) => job.queue_key)).toEqual([
      `automation:${automation_id}:subject:2026-10-20T09:00:00.000Z`,
    ]);
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ trigger_name: 'Morning report', outcome: 'waiting' });
  });

  it('runs now on request, with no clock and no outside scheduler', async () => {
    const fixture = await create_scheduled_automation();
    const automation_id = fixture.automation.automation_id;

    const response = await fixture.app.request(`/v1/automations/${automation_id}/run-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ occurrence_key: 'run_now_walk' }),
    });

    expect(response.status).toBe(202);
    expect((await response.json()).data.fired).toBe(true);
    expect(await list_automation_jobs(fixture)).toHaveLength(1);
    expect(await read_fires(fixture.app, automation_id)).toHaveLength(1);
  });
});
