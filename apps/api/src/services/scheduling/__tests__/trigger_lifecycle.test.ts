import { beforeEach, describe, expect, it, vi } from 'vitest';

const cron_schedule = {
  supports_run_once: true,
  set_schedule: vi.fn(async () => {}),
  pause_schedule: vi.fn(async () => {}),
  delete_schedule: vi.fn(async () => {}),
};
vi.mock('@api/services/scheduling/cron_schedule', () => ({
  get_cron_schedule: async () => cron_schedule,
}));

const { create_app } = await import('@api/app');
const { proxy_auth_headers } = await import('@api/lib/proxy_identity');
const { build_scheduled_task_run_authority } = await import(
  '@coworker/core/services/scheduled_task_authority'
);
const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
const { triggers } = await import('@coworker/core/db/schema');
const { eq } = await import('drizzle-orm');

const dev_secret = 'local-development-internal-api-secret';

function workspace_headers() {
  return new Headers([
    [proxy_auth_headers.secret, dev_secret],
    [proxy_auth_headers.provider_key, 'workos'],
    [proxy_auth_headers.provider_user_id, 'user_sched'],
    [proxy_auth_headers.organization_id, 'org_sched'],
    ['Content-Type', 'application/json'],
  ]);
}

async function new_app() {
  return create_app(await create_test_database());
}

async function new_app_with_db() {
  const db = await create_test_database();
  return { db, app: create_app(db) };
}

async function create_schedule_trigger(app: ReturnType<typeof create_app>) {
  const created = await (
    await app.request('/v1/triggers', {
      method: 'POST',
      headers: workspace_headers(),
      body: JSON.stringify({
        trigger_name: 'Daily digest',
        trigger_type: 'schedule',
        schedule_expression: '0 9 * * *',
        trigger_config: { starts_job_handler: 'daily_digest' },
      }),
    })
  ).json();
  return created.data.trigger_id as string;
}

describe('trigger lifecycle keeps the DB row and the cron schedule consistent', () => {
  beforeEach(() => {
    cron_schedule.set_schedule.mockClear();
    cron_schedule.pause_schedule.mockClear();
    cron_schedule.delete_schedule.mockClear();
  });

  it('schedules on create, pauses on disable, reschedules on enable, deletes on delete', async () => {
    const app = await new_app();
    const headers = workspace_headers();

    const created = await (
      await app.request('/v1/triggers', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          trigger_name: 'Daily digest',
          trigger_type: 'schedule',
          schedule_expression: '0 9 * * *',
          trigger_config: { starts_job_handler: 'daily_digest', timezone: 'Europe/Rome' },
        }),
      })
    ).json();
    const trigger_id = created.data.trigger_id;

    expect(cron_schedule.set_schedule).toHaveBeenCalledTimes(1);
    expect(cron_schedule.set_schedule).toHaveBeenCalledWith({
      trigger_id,
      cron_expression: '0 9 * * *',
      timezone: 'Europe/Rome',
    });

    await app.request(`/v1/triggers/${trigger_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ trigger_status: 'disabled' }),
    });
    expect(cron_schedule.pause_schedule).toHaveBeenCalledWith(trigger_id);

    await app.request(`/v1/triggers/${trigger_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ trigger_status: 'enabled' }),
    });
    expect(cron_schedule.set_schedule).toHaveBeenCalledTimes(2);

    const deleted = await app.request(`/v1/triggers/${trigger_id}`, {
      method: 'DELETE',
      headers,
    });
    expect(deleted.status).toBe(200);
    expect(cron_schedule.delete_schedule).toHaveBeenCalledWith(trigger_id);
  });

  it('edits a schedule trigger in place and reschedules the same trigger id', async () => {
    const { db, app } = await new_app_with_db();
    const headers = workspace_headers();
    const trigger_id = await create_schedule_trigger(app);
    cron_schedule.set_schedule.mockClear();

    const response = await app.request(`/v1/triggers/${trigger_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        trigger_name: 'Weekly digest',
        schedule_expression: '0 10 * * 1',
        trigger_config: { starts_job_handler: 'daily_digest', timezone: 'Europe/Rome' },
      }),
    });
    const body = await response.json();
    const rows = await db.query.triggers.findMany({ where: eq(triggers.trigger_id, trigger_id) });

    expect(response.status).toBe(200);
    expect(body.data.trigger_id).toBe(trigger_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      trigger_id,
      trigger_name: 'Weekly digest',
      schedule_expression: '0 10 * * 1',
    });
    expect(cron_schedule.set_schedule).toHaveBeenCalledWith({
      trigger_id,
      cron_expression: '0 10 * * 1',
      timezone: 'Europe/Rome',
    });
  });

  it('caps live agent-created scheduled tasks at 10 per workspace', async () => {
    const app = await new_app();
    const headers = workspace_headers();
    const body = (index: number) =>
      JSON.stringify({
        trigger_name: `Agent task ${index}`,
        trigger_type: 'schedule',
        schedule_expression: `${index} 9 * * *`,
        trigger_config: {
          starts_job_handler: 'run_scheduled_agent_task',
          job_input: { instruction: `Send update ${index}.` },
        },
        trigger_source: { origin: 'agent_tool' },
      });

    for (let index = 0; index < 10; index += 1) {
      const response = await app.request('/v1/triggers', {
        method: 'POST',
        headers,
        body: body(index),
      });
      expect(response.status).toBe(201);
    }

    const rejected = await app.request('/v1/triggers', {
      method: 'POST',
      headers,
      body: body(10),
    });

    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: 'validation_error', details: { cap: 10 } },
    });
  });

  it('records authority for a scheduled task created by a dashboard user', async () => {
    const { db, app } = await new_app_with_db();
    const instruction = 'Send the weekly customer update.';
    const response = await app.request('/v1/triggers', {
      method: 'POST',
      headers: workspace_headers(),
      body: JSON.stringify({
        trigger_name: 'Weekly customer update',
        trigger_type: 'schedule',
        schedule_expression: '0 9 * * 1',
        trigger_config: {
          starts_job_handler: 'run_scheduled_agent_task',
          job_input: { instruction },
        },
      }),
    });
    const body = await response.json();
    const trigger = await db.query.triggers.findFirst({
      where: eq(triggers.trigger_id, body.data.trigger_id),
    });

    expect(response.status).toBe(201);
    expect(
      build_scheduled_task_run_authority(
        body.data.trigger_id,
        trigger?.trigger_source,
        instruction,
      ),
    ).not.toBeNull();
  });

  it('pauses the schedule when a trigger goes into error status', async () => {
    const app = await new_app();
    const headers = workspace_headers();

    const created = await (
      await app.request('/v1/triggers', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          trigger_name: 'Daily digest',
          trigger_type: 'schedule',
          schedule_expression: '0 9 * * *',
          trigger_config: { starts_job_handler: 'daily_digest' },
        }),
      })
    ).json();
    const trigger_id = created.data.trigger_id;
    cron_schedule.set_schedule.mockClear();

    await app.request(`/v1/triggers/${trigger_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ trigger_status: 'error' }),
    });

    expect(cron_schedule.pause_schedule).toHaveBeenCalledWith(trigger_id);
    expect(cron_schedule.set_schedule).not.toHaveBeenCalled();
  });

  it('does NOT schedule a recurring job for a non-schedule trigger', async () => {
    const app = await new_app();
    const headers = workspace_headers();

    await app.request('/v1/triggers', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        trigger_name: 'Inbound webhook',
        trigger_type: 'webhook',
        trigger_config: { starts_job_handler: 'handle_webhook' },
      }),
    });

    expect(cron_schedule.set_schedule).not.toHaveBeenCalled();
  });

  it('removing a trigger deletes the cron schedule and then the DB row', async () => {
    const { db, app } = await new_app_with_db();
    const trigger_id = await create_schedule_trigger(app);

    const response = await app.request(`/v1/triggers/${trigger_id}`, {
      method: 'DELETE',
      headers: workspace_headers(),
    });

    expect(response.status).toBe(200);
    expect(cron_schedule.delete_schedule).toHaveBeenCalledWith(trigger_id);
    const rows = await db.query.triggers.findMany({ where: eq(triggers.trigger_id, trigger_id) });
    expect(rows).toHaveLength(0);
  });

  it('rejects a one-time task whose run time is in the past with a 422', async () => {
    const app = await new_app();
    const past = new Date(Date.now() - 60_000).toISOString();

    const response = await app.request('/v1/triggers', {
      method: 'POST',
      headers: workspace_headers(),
      body: JSON.stringify({
        trigger_name: 'One-time backup',
        trigger_type: 'schedule',
        schedule_expression: '30 9 1 7 *',
        trigger_config: { starts_job_handler: 'run_scheduled_agent_task', run_once_at: past },
      }),
    });

    expect(response.status).toBe(422);
    expect(cron_schedule.set_schedule).not.toHaveBeenCalled();
  });

  it('rejects a one-time task and rolls back the row when the backend cannot run-once', async () => {
    const { db, app } = await new_app_with_db();
    cron_schedule.supports_run_once = false;
    const future = new Date(Date.now() + 60 * 60_000).toISOString();

    const response = await app.request('/v1/triggers', {
      method: 'POST',
      headers: workspace_headers(),
      body: JSON.stringify({
        trigger_name: 'One-time on cron-only backend',
        trigger_type: 'schedule',
        schedule_expression: '30 9 1 7 *',
        trigger_config: { starts_job_handler: 'run_scheduled_agent_task', run_once_at: future },
      }),
    });

    expect(response.status).toBe(422);
    expect(cron_schedule.set_schedule).not.toHaveBeenCalled();
    const rows = await db.query.triggers.findMany();
    expect(rows).toHaveLength(0);
    cron_schedule.supports_run_once = true;
  });

  it('does NOT change the DB status when the cloud pause fails (provider-first atomicity)', async () => {
    const { db, app } = await new_app_with_db();
    const trigger_id = await create_schedule_trigger(app);
    cron_schedule.pause_schedule.mockRejectedValueOnce(new Error('AWS throttled'));

    const response = await app.request(`/v1/triggers/${trigger_id}`, {
      method: 'PATCH',
      headers: workspace_headers(),
      body: JSON.stringify({ trigger_status: 'disabled' }),
    });

    expect(response.status).toBe(500);
    const [row] = await db.query.triggers.findMany({ where: eq(triggers.trigger_id, trigger_id) });
    expect(row?.trigger_status).toBe('enabled');
  });

  it('keeps the trigger row when the cron schedule delete fails, so it never orphans a firing job', async () => {
    const { db, app } = await new_app_with_db();
    const trigger_id = await create_schedule_trigger(app);
    cron_schedule.delete_schedule.mockRejectedValueOnce(new Error('GCP unavailable'));

    const response = await app.request(`/v1/triggers/${trigger_id}`, {
      method: 'DELETE',
      headers: workspace_headers(),
    });

    expect(response.status).toBe(500);
    const rows = await db.query.triggers.findMany({ where: eq(triggers.trigger_id, trigger_id) });
    expect(rows).toHaveLength(1);
  });
});
