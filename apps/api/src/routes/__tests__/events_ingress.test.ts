import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_run } from '@coworker/core/db/queries/sessions';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import { create_trigger, update_trigger_status } from '@coworker/core/db/queries/trigger_writes';
import { event_jobs } from '@coworker/core/db/schema';
import { agent_heartbeat_job_handler } from '@coworker/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const test_proxy_secret =
  process.env.COWORKER_API_PROXY_SECRET ?? 'local-development-internal-api-secret';

function fire({ with_secret = true }: { with_secret?: boolean } = {}) {
  const headers = new Headers();
  if (with_secret) headers.set(proxy_auth_headers.secret, test_proxy_secret);
  return { method: 'POST', headers } as const;
}

async function make_schedule_trigger(db: Awaited<ReturnType<typeof create_test_database>>) {
  const bootstrap = await bootstrap_default_workspace(db);
  const trigger = await create_trigger(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    trigger_name: 'Daily digest',
    trigger_type: 'schedule',
    schedule_expression: '0 9 * * *',
    trigger_config: { starts_job_handler: 'daily_digest', timezone: 'UTC' },
    actor_id: bootstrap.user_id,
  });
  return { bootstrap, trigger };
}

describe('POST /v1/events/:trigger_id (generic trigger ingress)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires a bodyless scheduler call once per minute, not once ever', async () => {
    const db = await create_test_database();
    const { bootstrap, trigger } = await make_schedule_trigger(db);
    const app = create_app(db);

    const count_jobs = async () =>
      (
        await db.query.event_jobs.findMany({
          where: and(
            eq(event_jobs.workspace_id, bootstrap.workspace_id),
            eq(event_jobs.job_handler, 'daily_digest'),
          ),
        })
      ).length;

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T09:00:30.000Z'));
    await app.request(`/v1/events/${trigger.trigger_id}`, fire());
    await app.request(`/v1/events/${trigger.trigger_id}`, fire());
    expect(await count_jobs()).toBe(1);

    vi.setSystemTime(new Date('2026-06-13T09:01:10.000Z'));
    await app.request(`/v1/events/${trigger.trigger_id}`, fire());
    expect(await count_jobs()).toBe(2);
  });

  it('rejects a fire without the proxy secret', async () => {
    const db = await create_test_database();
    const { trigger } = await make_schedule_trigger(db);
    const app = create_app(db);

    const response = await app.request(
      `/v1/events/${trigger.trigger_id}`,
      fire({ with_secret: false }),
    );

    expect(response.status).toBe(401);
  });

  it('rejects a user-proxied fire even with the secret, so a user cannot fire across workspaces', async () => {
    const db = await create_test_database();
    const { trigger } = await make_schedule_trigger(db);
    const app = create_app(db);

    const headers = new Headers([
      [proxy_auth_headers.secret, test_proxy_secret],
      [proxy_auth_headers.provider_user_id, 'user_123'],
    ]);
    const response = await app.request(`/v1/events/${trigger.trigger_id}`, {
      method: 'POST',
      headers,
    });

    expect(response.status).toBe(403);
  });

  it('404s an unknown trigger', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = create_app(db);

    const response = await app.request('/v1/events/trg_does_not_exist', fire());

    expect(response.status).toBe(404);
  });

  it('fires an enabled trigger into the event pipeline', async () => {
    const db = await create_test_database();
    const { bootstrap, trigger } = await make_schedule_trigger(db);
    const app = create_app(db);

    const response = await app.request(`/v1/events/${trigger.trigger_id}`, fire());
    const body = (await response.json()).data;

    const jobs = await db.query.event_jobs.findMany({
      where: and(
        eq(event_jobs.workspace_id, bootstrap.workspace_id),
        eq(event_jobs.job_handler, 'daily_digest'),
      ),
    });

    expect(response.status).toBe(202);
    expect(body.fired).toBe(true);
    expect(body.queued_job_count).toBe(1);
    expect(jobs).toHaveLength(1);
  });

  it('records last_run_time on a fire, and not again on a deduped retry', async () => {
    const db = await create_test_database();
    const { bootstrap, trigger } = await make_schedule_trigger(db);
    const app = create_app(db);

    const before = await get_trigger_by_id(db, trigger.trigger_id);
    expect(before?.last_run_time).toBeNull();

    const body = JSON.stringify({ occurrence_key: '2026-06-13T09:00' });
    const headers = new Headers([
      [proxy_auth_headers.secret, test_proxy_secret],
      ['Content-Type', 'application/json'],
    ]);
    await app.request(`/v1/events/${trigger.trigger_id}`, { method: 'POST', headers, body });
    const fired = await get_trigger_by_id(db, trigger.trigger_id);
    expect(fired?.last_run_time).not.toBeNull();
    expect(fired?.workspace_id).toBe(bootstrap.workspace_id);

    await app.request(`/v1/events/${trigger.trigger_id}`, { method: 'POST', headers, body });
    const retried = await get_trigger_by_id(db, trigger.trigger_id);
    expect(retried?.last_run_time?.getTime()).toBe(fired?.last_run_time?.getTime());
  });

  it('dedups repeat fires with the same occurrence key', async () => {
    const db = await create_test_database();
    const { bootstrap, trigger } = await make_schedule_trigger(db);
    const app = create_app(db);

    const body = JSON.stringify({ occurrence_key: '2026-06-13T09:00' });
    const headers = new Headers([
      [proxy_auth_headers.secret, test_proxy_secret],
      ['Content-Type', 'application/json'],
    ]);
    await app.request(`/v1/events/${trigger.trigger_id}`, { method: 'POST', headers, body });
    await app.request(`/v1/events/${trigger.trigger_id}`, { method: 'POST', headers, body });

    const jobs = await db.query.event_jobs.findMany({
      where: and(
        eq(event_jobs.workspace_id, bootstrap.workspace_id),
        eq(event_jobs.job_handler, 'daily_digest'),
      ),
    });

    expect(jobs).toHaveLength(1);
  });

  it('ignores a disabled trigger without enqueuing work', async () => {
    const db = await create_test_database();
    const { bootstrap, trigger } = await make_schedule_trigger(db);
    const app = create_app(db);

    await update_trigger_status(db, {
      workspace_id: bootstrap.workspace_id,
      trigger_id: trigger.trigger_id,
      trigger_status: 'disabled',
      actor_id: bootstrap.user_id,
    });

    const response = await app.request(`/v1/events/${trigger.trigger_id}`, fire());
    const body = (await response.json()).data;

    const jobs = await db.query.event_jobs.findMany({
      where: and(
        eq(event_jobs.workspace_id, bootstrap.workspace_id),
        eq(event_jobs.job_handler, 'daily_digest'),
      ),
    });

    expect(response.status).toBe(200);
    expect(body.fired).toBe(false);
    expect(body.reason).toBe('trigger_disabled');
    expect(jobs).toHaveLength(0);
  });

  it('acknowledges a trigger with no job handler without enqueuing work', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const trigger = await create_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_name: 'Handlerless',
      trigger_type: 'schedule',
      schedule_expression: '0 9 * * *',
      trigger_config: {},
      actor_id: bootstrap.user_id,
    });
    const app = create_app(db);

    const response = await app.request(`/v1/events/${trigger.trigger_id}`, fire());
    const body = (await response.json()).data;

    const jobs = await db.query.event_jobs.findMany({
      where: eq(event_jobs.workspace_id, bootstrap.workspace_id),
    });

    expect(response.status).toBe(200);
    expect(body.fired).toBe(false);
    expect(body.reason).toBe('no_job_handler');
    expect(jobs).toHaveLength(0);
  });

  it('refuses a malformed JSON body with 422 and fires nothing', async () => {
    const db = await create_test_database();
    const { trigger } = await make_schedule_trigger(db);
    const app = create_app(db);

    const headers = new Headers([
      [proxy_auth_headers.secret, test_proxy_secret],
      ['Content-Type', 'application/json'],
    ]);
    const response = await app.request(`/v1/events/${trigger.trigger_id}`, {
      method: 'POST',
      headers,
      body: '{not valid json',
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: 'validation_error',
      message: 'Request body must be valid JSON',
    });
    expect(await db.query.event_jobs.findMany()).toHaveLength(0);
  });
});

describe('POST /v1/triggers/:trigger_id/run', () => {
  afterEach(() => vi.useRealTimers());

  it('queues a manual task once per occurrence and lists persisted run counts', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);
    const trigger = await create_trigger(db, {
      ...bootstrap,
      trigger_name: 'Manual report',
      trigger_type: 'manual',
      trigger_config: {
        starts_job_handler: 'run_scheduled_agent_task',
        job_input: { instruction: 'Write the report.' },
      },
      actor_id: bootstrap.user_id,
    });
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ occurrence_key: 'same-click' }),
    };
    vi.useFakeTimers();
    const first = await app.request(`/v1/triggers/${trigger.trigger_id}/run`, request);
    const first_body = (await first.json()).data;
    const fired_trigger = await get_trigger_by_id(db, trigger.trigger_id);
    const retry = await app.request(`/v1/triggers/${trigger.trigger_id}/run`, request);
    const retry_body = (await retry.json()).data;
    expect(first.status).toBe(202);
    expect(first_body.fired).toBe(true);
    expect(first_body.event_job_ids).toEqual([expect.stringMatching(/^ejob_/)]);
    expect(retry_body).toMatchObject({ fired: false, event_id: first_body.event_id });
    expect((await get_trigger_by_id(db, trigger.trigger_id))?.last_run_time).toEqual(
      fired_trigger?.last_run_time,
    );
    expect(fired_trigger?.last_run_time).not.toBeNull();
    const jobs = await db.query.event_jobs.findMany({
      where: eq(event_jobs.event_id, first_body.event_id),
    });
    expect(jobs.map((job) => job.job_id)).toEqual(first_body.event_job_ids);
    const before = (await (await app.request('/v1/triggers')).json()).data;
    expect(
      before.find((row: { trigger_id: string }) => row.trigger_id === trigger.trigger_id),
    ).toMatchObject({ run_count: 0 });
    await create_run(db, {
      ...bootstrap,
      session_id: 'session_count_check',
      trigger_id: trigger.trigger_id,
      trigger_type: 'api',
      actor_id: bootstrap.user_id,
    });
    const after = (await (await app.request('/v1/triggers')).json()).data;
    expect(
      after.find((row: { trigger_id: string }) => row.trigger_id === trigger.trigger_id),
    ).toMatchObject({ run_count: 1 });
  });

  it('rejects disabled, system, foreign, missing, and malformed task requests', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);
    const [disabled, system, foreign] = await Promise.all(
      [
        { trigger_status: 'disabled' as const },
        { trigger_config: { starts_job_handler: agent_heartbeat_job_handler } },
        { workspace_id: 'workspace_elsewhere' },
      ].map((overrides) =>
        create_trigger(db, {
          ...bootstrap,
          trigger_name: 'Restricted task',
          trigger_type: 'manual',
          trigger_config: { starts_job_handler: 'run_scheduled_agent_task' },
          actor_id: bootstrap.user_id,
          ...overrides,
        }),
      ),
    );
    if (!disabled || !system || !foreign) throw new Error('Missing test triggers');
    for (const [trigger_id, body, status] of [
      [disabled.trigger_id, { occurrence_key: 'click' }, 409],
      [system.trigger_id, { occurrence_key: 'click' }, 404],
      [foreign.trigger_id, { occurrence_key: 'click' }, 404],
      ['missing', { occurrence_key: 'click' }, 404],
      [disabled.trigger_id, {}, 422],
      [disabled.trigger_id, { occurrence_key: 'click', unexpected: true }, 422],
    ] as const) {
      const response = await app.request(`/v1/triggers/${trigger_id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(status);
    }
    expect(await db.query.event_jobs.findMany()).toHaveLength(0);
  });
});
