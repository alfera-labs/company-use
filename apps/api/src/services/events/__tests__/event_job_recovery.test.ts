import { recover_stuck_jobs_and_run_ready_queues } from '@api/services/events/event_job_recovery';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_pending_connection_setup,
  pending_connection_setup_expiry_ms,
} from '@coworker/core/db/queries/connection_management';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import {
  acquire_session_execution_lock,
  create_run,
  create_run_message,
  create_session,
  update_run_status,
} from '@coworker/core/db/queries/sessions';
import { apps, connections, event_jobs, sessions } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const workspace_id = 'ws_event_recovery';
const queue_key = 'event_recovery:test';

describe('event job recovery', () => {
  it('recovers expired running jobs and runs them', async () => {
    const db = await create_test_database();
    const queued = await enqueue_event_jobs(db, {
      workspace_id,
      source: 'test',
      source_event_id: 'evt_event_recovery',
      event_type: 'test.event',
      queue_key,
      actor_key: 'test:user',
      event_jobs: [{ job_handler: 'missing_test_handler' }],
    });
    const job = queued.event_jobs[0];
    expect(job).toBeDefined();
    if (!job) throw new Error('Expected queued event job');

    await db
      .update(event_jobs)
      .set({
        job_status: 'running',
        locked_by: 'dead_worker',
        locked_until: new Date('2026-01-01T00:00:00.000Z'),
        attempt_count: 1,
        last_updated_time: new Date('2026-01-01T00:00:00.000Z'),
        last_updated_by: 'test',
      })
      .where(eq(event_jobs.job_id, job.job_id));

    const result = await recover_stuck_jobs_and_run_ready_queues(db, {
      worker_id_prefix: 'test_recovery',
      max_queue_runs: 5,
    });

    expect(result).toEqual({
      recovered_jobs: 1,
      recovered_runs: 0,
      expired_connection_setups: 0,
      queues_ran: 1,
      jobs_ran: 1,
      capped: false,
    });

    const stored = await db.query.event_jobs.findFirst({
      where: eq(event_jobs.job_id, job.job_id),
    });
    expect(stored?.job_status).toBe('failed');
    expect(stored?.locked_by).toBeNull();
    expect(stored?.locked_until).toBeNull();
    expect(stored?.attempt_count).toBe(1);
    expect(stored?.interruption_count).toBe(1);
    expect(stored?.error_data).toMatchObject({ code: 'event_job_handler_missing' });
  });

  it('runs a ready queued job even when nothing expired, so a retry survives a restart', async () => {
    const db = await create_test_database();
    const queued = await enqueue_event_jobs(db, {
      workspace_id,
      source: 'test',
      source_event_id: 'evt_event_recovery_ready',
      event_type: 'test.event',
      queue_key,
      actor_key: 'test:user',
      event_jobs: [
        { job_handler: 'missing_test_handler', available_time: new Date(Date.now() - 5_000) },
      ],
    });
    const job = queued.event_jobs[0];
    expect(job).toBeDefined();
    if (!job) throw new Error('Expected queued event job');

    const result = await recover_stuck_jobs_and_run_ready_queues(db, {
      worker_id_prefix: 'test_recovery',
      max_queue_runs: 5,
    });

    expect(result.recovered_jobs).toBe(0);
    expect(result.recovered_runs).toBe(0);
    expect(result.expired_connection_setups).toBe(0);
    expect(result.jobs_ran).toBe(1);

    const stored = await db.query.event_jobs.findFirst({
      where: eq(event_jobs.job_id, job.job_id),
    });
    expect(stored?.job_status).toBe('failed');
  });

  it('marks stale running runs failed and hides their messages from the model', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    await acquire_session_execution_lock(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      actor_id: bootstrap.user_id,
      lease_ms: 1,
    });
    await update_run_status(db, {
      run_id: run.run_id,
      run_status: 'running',
      actor_id: bootstrap.user_id,
    });
    const message = await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'assistant',
      message_content: {
        type: 'text',
        parts: [
          {
            type: 'tool_call',
            id: 'call_abandoned',
            name: 'runtime-create_connection-1',
            arguments: {},
          },
        ],
      },
      source_type: 'runtime',
      actor_id: bootstrap.user_id,
    });
    await db
      .update(sessions)
      .set({ lock_expires_time: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(sessions.session_id, session.session_id));

    const result = await recover_stuck_jobs_and_run_ready_queues(db, {
      worker_id_prefix: 'test_recovery',
      max_queue_runs: 5,
    });

    expect(result).toEqual({
      recovered_jobs: 0,
      recovered_runs: 1,
      expired_connection_setups: 0,
      queues_ran: 0,
      jobs_ran: 0,
      capped: false,
    });

    const stored_run = await db.query.runs.findFirst({
      where: (table) => eq(table.run_id, run.run_id),
    });
    const stored_message = await db.query.run_messages.findFirst({
      where: (table) => eq(table.run_message_id, message.run_message_id),
    });
    const stored_session = await db.query.sessions.findFirst({
      where: (table) => eq(table.session_id, session.session_id),
    });
    expect(stored_run?.run_status).toBe('failed');
    expect(stored_message?.is_model_visible).toBe(false);
    expect(stored_session?.locked_by_run_id).toBeNull();
    expect(stored_session?.active_run_id).toBeNull();
  });

  it('recovers a queued run when the worker dies after publishing its run id', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Queued run crash recovery',
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    await acquire_session_execution_lock(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      actor_id: bootstrap.user_id,
      lease_ms: 1,
    });
    await db
      .update(sessions)
      .set({ lock_expires_time: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(sessions.session_id, session.session_id));

    const result = await recover_stuck_jobs_and_run_ready_queues(db, {
      max_queue_runs: 0,
    });
    const recovered_run = await db.query.runs.findFirst({
      where: (table) => eq(table.run_id, run.run_id),
    });
    const recovered_session = await db.query.sessions.findFirst({
      where: (table) => eq(table.session_id, session.session_id),
    });

    expect(result.recovered_runs).toBe(1);
    expect(recovered_run?.run_status).toBe('failed');
    expect(recovered_session?.locked_by_run_id).toBeNull();
  });

  it('expires stale pending connection setups during recovery', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const [app] = await db
      .insert(apps)
      .values({
        app_id: 'app_event_recovery_expiry',
        app_name: 'event_recovery_expiry',
        app_key: 'event_recovery_expiry',
        catalog_scope: 'global',
        app_display_name: 'Event Recovery Expiry',
        auth_type: 'oauth2',
        app_status: 'active',
        display_config: {},
        metadata: { source: 'composio' },
        created_by: 'test',
        last_updated_by: 'test',
      })
      .returning();
    if (!app) throw new Error('App was not inserted');

    const setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
      resume: {
        session_id: 'ses_resume',
        instruction: 'Resume this after connect.',
        created_at: new Date().toISOString(),
      },
    });
    await db
      .update(connections)
      .set({
        created_time: new Date(Date.now() - pending_connection_setup_expiry_ms),
        setup_state: {
          ...(setup.setup as Record<string, unknown>),
          setup_started_time: new Date(
            Date.now() - pending_connection_setup_expiry_ms,
          ).toISOString(),
        },
      })
      .where(eq(connections.connection_id, setup.connection.connection_id));

    const result = await recover_stuck_jobs_and_run_ready_queues(db, {
      worker_id_prefix: 'test_recovery',
      max_queue_runs: 5,
    });

    expect(result).toEqual({
      recovered_jobs: 0,
      recovered_runs: 0,
      expired_connection_setups: 1,
      queues_ran: 0,
      jobs_ran: 0,
      capped: false,
    });

    const stored_connection = await db.query.connections.findFirst({
      where: (table) => eq(table.connection_id, setup.connection.connection_id),
    });
    expect(stored_connection).toMatchObject({
      connection_status: 'expired',
      health_status: 'unhealthy',
      setup_state: expect.objectContaining({
        expired_reason: 'setup_timed_out',
      }),
    });
    expect(stored_connection?.setup_state).not.toHaveProperty('resume');
    expect(stored_connection?.setup_state).not.toHaveProperty('provider_webhook_token');
  });
});
