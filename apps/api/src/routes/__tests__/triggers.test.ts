import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_run, create_run_message, create_session } from '@coworker/core/db/queries/sessions';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { triggers } from '@coworker/core/db/schema';
import { agent_heartbeat_job_handler } from '@coworker/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('trigger api routes', () => {
  it('tracks unread state for each trigger run', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);
    const trigger = await create_trigger(db, {
      ...bootstrap,
      trigger_name: 'Daily product pulse',
      trigger_type: 'manual',
      actor_id: bootstrap.user_id,
    });
    const session = await create_session(db, {
      ...bootstrap,
      session_title: 'Daily product pulse',
      actor_id: bootstrap.user_id,
    });
    const first_run = await create_run(db, {
      ...bootstrap,
      session_id: session.session_id,
      trigger_id: trigger.trigger_id,
      trigger_type: 'api',
      actor_id: bootstrap.user_id,
    });
    await create_run_message(db, {
      ...bootstrap,
      session_id: session.session_id,
      run_id: first_run.run_id,
      message_role: 'assistant',
      message_content: { type: 'text', text: 'First result' },
      source_type: 'runtime',
      actor_id: bootstrap.user_id,
    });
    await app.request(`/v1/triggers/${trigger.trigger_id}/runs/read`, { method: 'POST' });

    const second_run = await create_run(db, {
      ...bootstrap,
      session_id: session.session_id,
      trigger_id: trigger.trigger_id,
      trigger_type: 'api',
      actor_id: bootstrap.user_id,
    });
    await create_run_message(db, {
      ...bootstrap,
      session_id: session.session_id,
      run_id: second_run.run_id,
      message_role: 'assistant',
      message_content: { type: 'text', text: 'Second result' },
      source_type: 'runtime',
      actor_id: bootstrap.user_id,
    });

    const response = await app.request(`/v1/triggers/${trigger.trigger_id}/runs`);
    const page = (await response.json()).data;
    expect(response.status).toBe(200);
    expect(page.items).toEqual([
      expect.objectContaining({ run_id: second_run.run_id, run_number: 2, is_unread: true }),
      expect.objectContaining({ run_id: first_run.run_id, run_number: 1, is_unread: false }),
    ]);
  });

  it('creates, lists, and updates triggers', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = create_app(db);

    const create_response = await app.request('/v1/triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger_name: 'Daily product pulse node',
        trigger_type: 'schedule',
        node_id: 'node_daily_pulse',
        trigger_config: {
          max_runtime_seconds: 300,
        },
        trigger_source: {
          kind: 'schedule',
          timezone: 'Europe/Rome',
        },
        schedule_expression: '0 9 * * 1-5',
      }),
    });
    const created = (await create_response.json()).data;

    const list_response = await app.request('/v1/triggers');
    const listed = (await list_response.json()).data;
    const patch_response = await app.request(`/v1/triggers/${created.trigger_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger_status: 'disabled' }),
    });
    const patched = (await patch_response.json()).data;

    expect(create_response.status).toBe(201);
    expect(created.trigger_id).toMatch(/^trg_/);
    expect(created).toMatchObject({
      trigger_name: 'Daily product pulse node',
      trigger_type: 'schedule',
      trigger_status: 'enabled',
      node_id: 'node_daily_pulse',
      trigger_config: {
        max_runtime_seconds: 300,
      },
      trigger_source: {
        kind: 'schedule',
        timezone: 'Europe/Rome',
      },
      trigger_target: {
        kind: 'node_run',
        node_id: 'node_daily_pulse',
      },
      schedule_expression: '0 9 * * 1-5',
    });
    expect(list_response.status).toBe(200);
    expect(listed).toHaveLength(1);
    expect(patch_response.status).toBe(200);
    expect(patched.trigger_status).toBe('disabled');
  });

  it('keeps the system scout out of user-managed scheduled tasks', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = create_app(db);

    const create_response = await app.request('/v1/triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger_name: 'Agent scout',
        trigger_type: 'schedule',
        trigger_config: { starts_job_handler: agent_heartbeat_job_handler },
        schedule_expression: '1 8,11,14,17 * * 1-5',
      }),
    });
    const scout = (await create_response.json()).data;

    const list_response = await app.request('/v1/triggers');
    const listed = (await list_response.json()).data;
    const patch_response = await app.request(`/v1/triggers/${scout.trigger_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger_name: 'Changed scout' }),
    });
    const delete_response = await app.request(`/v1/triggers/${scout.trigger_id}`, {
      method: 'DELETE',
    });

    expect(create_response.status).toBe(201);
    expect(listed).toHaveLength(0);
    expect(patch_response.status).toBe(404);
    expect(delete_response.status).toBe(404);
  });

  it('never takes the wire keys or the job handler from a request body', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);
    const victim_wire = { provisioned_by: 'composio', provisioning_key: 'ti_other_workspace' };

    const create_response = await app.request('/v1/triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger_name: 'Steal the wedding mail',
        trigger_type: 'manual',
        trigger_config: { ...victim_wire, event_source: { node_key: 'x', connection_id: 'c' } },
      }),
    });
    const created = (await create_response.json()).data;

    await db
      .update(triggers)
      .set({ trigger_config: { starts_job_handler: 'run_scheduled_agent_task' } })
      .where(eq(triggers.trigger_id, created.trigger_id));

    const patch_response = await app.request(`/v1/triggers/${created.trigger_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger_config: {
          ...victim_wire,
          starts_job_handler: agent_heartbeat_job_handler,
          job_input: { instruction: 'Say hello.' },
        },
      }),
    });
    const patched = (await patch_response.json()).data;

    expect(create_response.status).toBe(201);
    expect(created.trigger_config).toEqual({});
    expect(patch_response.status).toBe(200);
    expect(patched.trigger_config).toEqual({
      job_input: { instruction: 'Say hello.' },
      starts_job_handler: 'run_scheduled_agent_task',
    });
    expect(bootstrap.workspace_id).toBeTruthy();
  });

  it('rejects an out-of-range cron before persisting it', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = create_app(db);

    const response = await app.request('/v1/triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger_name: 'Bad cron',
        trigger_type: 'schedule',
        schedule_expression: '60 24 * * *',
      }),
    });

    expect(response.status).toBe(422);
    const listed = (await (await app.request('/v1/triggers')).json()).data;
    expect(listed).toHaveLength(0);
  });

  it('rejects crons the AWS backend cannot represent (both day fields, stepped weekday)', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = create_app(db);

    for (const schedule_expression of ['0 9 1 1 0', '0 9 * * 1-5/2']) {
      const response = await app.request('/v1/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger_name: 'Bad cron',
          trigger_type: 'schedule',
          schedule_expression,
        }),
      });
      expect(response.status).toBe(422);
    }
    const listed = (await (await app.request('/v1/triggers')).json()).data;
    expect(listed).toHaveLength(0);
  });
});
