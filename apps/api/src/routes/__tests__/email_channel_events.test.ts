import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { workspaces } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const original_event_job_config = {
  API_URL: env.API_URL,
  COWORKER_API_PROXY_SECRET: env.COWORKER_API_PROXY_SECRET,
  EVENT_JOB_DISPATCH_MODE: env.EVENT_JOB_DISPATCH_MODE,
};

describe('email channel event route', () => {
  afterEach(() => {
    Object.assign(env, original_event_job_config);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('accepts a Resend email.received webhook and queues the agent-message job', async () => {
    vi.stubEnv('RESEND_INBOUND_WEBHOOK_SECRET', '');
    Object.assign(env, {
      API_URL: 'http://api.test',
      COWORKER_API_PROXY_SECRET: 'configured-proxy-secret',
      EVENT_JOB_DISPATCH_MODE: 'http',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok')),
    );
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await db
      .update(workspaces)
      .set({ inbound_email_username: 'acme' })
      .where(eq(workspaces.workspace_id, bootstrap.workspace_id));
    const { create_app } = await import('@api/app');
    const app = create_app(db);

    const response = await app.request('/v1/channels/email/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'email.received',
        created_at: '2026-08-01T00:00:00.000Z',
        data: {
          email_id: 'em_route_1',
          from: 'Ada <ada@example.com>',
          to: ['acme@inbox.test.alfera.ai'],
          subject: 'Weekly update',
          message_id: '<abc@example.com>',
        },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data).toMatchObject({
      accepted: true,
      channel_provider_key: 'email',
      provider_event_id: 'em_route_1',
      workspace_id: bootstrap.workspace_id,
      event_status: 'routed',
      queued_job_count: 1,
    });

    const [event] = await db.query.events.findMany({
      where: (table, { eq: eq_field }) => eq_field(table.source_event_id, 'received:em_route_1'),
    });
    expect(event?.workspace_id).toBe(bootstrap.workspace_id);
    const jobs = await db.query.event_jobs.findMany({
      where: (table, { eq: eq_field }) => eq_field(table.event_id, event?.event_id ?? ''),
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.job_handler).toBe('email_agent_message');
  });

  it('acknowledges without queueing when no workspace owns the recipient', async () => {
    vi.stubEnv('RESEND_INBOUND_WEBHOOK_SECRET', '');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const { create_app } = await import('@api/app');
    const app = create_app(db);

    const response = await app.request('/v1/channels/email/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'email.received',
        data: {
          email_id: 'em_route_2',
          from: 'ada@example.com',
          to: ['nobody@inbox.test.alfera.ai'],
          subject: 'Hello',
        },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data.accepted).toBe(true);
    expect(body.data.workspace_id).toBeUndefined();
    const events = await db.query.events.findMany({
      where: (table, { eq: eq_field }) => eq_field(table.source_event_id, 'received:em_route_2'),
    });
    expect(events).toHaveLength(0);
  });
});
