import { createHmac } from 'node:crypto';
import { vi } from 'vitest';

const { test_webhook_secret } = vi.hoisted(() => {
  const secret = 'composio_webhook_test_secret';
  process.env.COMPOSIO_WEBHOOK_SECRET = secret;
  return { test_webhook_secret: secret };
});

import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { apps, connections, event_jobs, events } from '@coworker/core/db/schema';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

type Db = Awaited<ReturnType<typeof create_test_database>>;

const wire_id = 'ti_8842a';

function gmail_envelope() {
  return {
    id: 'msg_abc123',
    type: 'composio.trigger.message',
    timestamp: '2026-09-15T09:04:12Z',
    metadata: {
      trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
      trigger_id: wire_id,
      connected_account_id: 'ca_def456',
    },
    data: { message_id: '18c2f9a44b', sender: 'sam@example.com', subject: 'Invoice 1042?' },
  };
}

function signed_delivery(input: {
  body: string;
  webhook_id: string;
  secret?: string;
  timestamp?: string;
}) {
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', input.secret ?? test_webhook_secret)
    .update(`${input.webhook_id}.${timestamp}.${input.body}`)
    .digest('base64');
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': input.webhook_id,
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${signature}`,
    },
    body: input.body,
  };
}

const our_account_id = 'ca_def456';

async function make_connection(db: Db, workspace_id: string, external_account_id: string) {
  const audit = { created_by: 'test', last_updated_by: 'test' };
  await db
    .insert(apps)
    .values({
      app_id: 'app_gmail',
      app_name: 'composio_gmail',
      app_key: 'composio_gmail',
      app_display_name: 'Gmail',
      ...audit,
    })
    .onConflictDoNothing();
  await db.insert(connections).values({
    connection_id: 'conn_test',
    workspace_id,
    app_id: 'app_gmail',
    connection_key: 'composio_gmail',
    connection_status: 'active',
    external_account_id,
    ...audit,
  });
}

async function make_event_trigger(
  db: Db,
  overrides: {
    trigger_status?: 'enabled' | 'disabled';
    external_account_id?: string;
    connection_id?: string | null;
    node_key?: string;
  } = {},
) {
  const bootstrap = await bootstrap_default_workspace(db);
  if (overrides.connection_id !== null) {
    await make_connection(
      db,
      bootstrap.workspace_id,
      overrides.external_account_id ?? our_account_id,
    );
  }
  const trigger = await create_trigger(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    trigger_name: 'Billing questions',
    trigger_type: 'app_event',
    trigger_config: {
      starts_job_handler: 'run_automation',
      provisioned_by: 'composio',
      provisioning_key: wire_id,
      event_source: {
        node_key: overrides.node_key ?? 'composio_gmail-new_gmail_message-1',
        trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
        ...(overrides.connection_id === null ? {} : { connection_id: 'conn_test' }),
      },
      rules: [{ field: 'sender', operation: 'is_absent' }],
      job_input: { instruction: 'Draft a reply.' },
    },
    trigger_status: overrides.trigger_status ?? 'enabled',
    actor_id: bootstrap.user_id,
  });
  return { bootstrap, trigger };
}

describe('POST /v1/triggers/deliveries/composio', () => {
  afterEach(() => {
    process.env.COMPOSIO_WEBHOOK_SECRET = test_webhook_secret;
    vi.resetModules();
  });

  it('answers 503 when no webhook secret is configured, instead of accepting it unverified', async () => {
    const db = await create_test_database();
    await make_event_trigger(db);
    vi.resetModules();
    vi.doMock('@coworker/config', async () => {
      const actual = await vi.importActual<typeof import('@coworker/config')>('@coworker/config');
      return { ...actual, env: { ...actual.env, COMPOSIO_WEBHOOK_SECRET: undefined } };
    });
    const { create_app: create_unconfigured_app } = await import('@api/app');
    const body = JSON.stringify(gmail_envelope());

    const response = await create_unconfigured_app(db).request(
      '/v1/triggers/deliveries/composio',
      signed_delivery({ body, webhook_id: 'msg_no_secret' }),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('composio_webhook_secret_missing');
    expect(await db.query.events.findMany()).toHaveLength(0);
    vi.doUnmock('@coworker/config');
    vi.resetModules();
  });

  it('answers 401 to a body signed with the wrong secret', async () => {
    const db = await create_test_database();
    await make_event_trigger(db);
    const body = JSON.stringify(gmail_envelope());

    const response = await create_app(db).request(
      '/v1/triggers/deliveries/composio',
      signed_delivery({ body, webhook_id: 'msg_bad', secret: 'not_the_secret' }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('invalid_signature');
    expect(await db.query.events.findMany()).toHaveLength(0);
  });

  it('answers 400 to a signed body that is not a delivery envelope', async () => {
    const db = await create_test_database();
    await make_event_trigger(db);
    const body = JSON.stringify({ hello: 'world' });

    const response = await create_app(db).request(
      '/v1/triggers/deliveries/composio',
      signed_delivery({ body, webhook_id: 'msg_garbage' }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_delivery');
  });

  it('answers 422 to a signed body that is not JSON', async () => {
    const db = await create_test_database();
    await make_event_trigger(db);

    const response = await create_app(db).request(
      '/v1/triggers/deliveries/composio',
      signed_delivery({ body: '{not json', webhook_id: 'msg_not_json' }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('validation_error');
    expect(await db.query.events.findMany()).toHaveLength(0);
  });

  it('answers 200 no_trigger for a wire nobody owns', async () => {
    const db = await create_test_database();
    await make_event_trigger(db);
    const envelope = gmail_envelope();
    envelope.metadata.trigger_id = 'ti_someone_else';
    const body = JSON.stringify(envelope);

    const response = await create_app(db).request(
      '/v1/triggers/deliveries/composio',
      signed_delivery({ body, webhook_id: 'msg_unknown' }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ received: false, reason: 'no_trigger' });
    expect(await db.query.events.findMany()).toHaveLength(0);
  });

  it('answers 200 trigger_disabled without queuing work', async () => {
    const db = await create_test_database();
    await make_event_trigger(db, { trigger_status: 'disabled' });
    const body = JSON.stringify(gmail_envelope());

    const response = await create_app(db).request(
      '/v1/triggers/deliveries/composio',
      signed_delivery({ body, webhook_id: 'msg_disabled' }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ received: false, reason: 'trigger_disabled' });
    expect(await db.query.event_jobs.findMany()).toHaveLength(0);
  });

  it('answers 200 account_mismatch when the delivery is from another account', async () => {
    const db = await create_test_database();
    await make_event_trigger(db, { external_account_id: 'ca_somebody_else' });
    const body = JSON.stringify(gmail_envelope());

    const response = await create_app(db).request(
      '/v1/triggers/deliveries/composio',
      signed_delivery({ body, webhook_id: 'msg_wrong_account' }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ received: false, reason: 'account_mismatch' });
    expect(await db.query.events.findMany()).toHaveLength(0);
  });

  it('fires a native ear that holds no connection', async () => {
    const db = await create_test_database();
    const { trigger } = await make_event_trigger(db, {
      connection_id: null,
      node_key: 'alfera_email-message_received-1',
    });
    const body = JSON.stringify(gmail_envelope());

    const response = await create_app(db).request(
      '/v1/triggers/deliveries/composio',
      signed_delivery({ body, webhook_id: 'msg_native_ear' }),
    );

    expect(response.status).toBe(202);
    expect((await response.json()).data).toMatchObject({
      received: true,
      fired: true,
      trigger_id: trigger.trigger_id,
    });
  });

  it('refuses a Composio trigger that holds no connection', async () => {
    const db = await create_test_database();
    await make_event_trigger(db, { connection_id: null });
    const body = JSON.stringify(gmail_envelope());

    const response = await create_app(db).request(
      '/v1/triggers/deliveries/composio',
      signed_delivery({ body, webhook_id: 'msg_no_connection' }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ received: false, reason: 'account_mismatch' });
    expect(await db.query.events.findMany()).toHaveLength(0);
  });

  it('refuses a delivery for an app this connection is not for', async () => {
    const db = await create_test_database();
    await make_event_trigger(db);
    const envelope = gmail_envelope();
    envelope.metadata.trigger_slug = 'STRIPE_CHARGE_FAILED';
    const body = JSON.stringify(envelope);

    const response = await create_app(db).request(
      '/v1/triggers/deliveries/composio',
      signed_delivery({ body, webhook_id: 'msg_wrong_app' }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ received: false, reason: 'account_mismatch' });
    expect(await db.query.events.findMany()).toHaveLength(0);
  });

  it('fires EVERY enabled trigger that shares the wire, one event each', async () => {
    const db = await create_test_database();
    const { bootstrap, trigger } = await make_event_trigger(db);
    const second = await create_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_name: 'Pay the invoices',
      trigger_type: 'app_event',
      trigger_config: {
        starts_job_handler: 'run_automation',
        provisioned_by: 'composio',
        provisioning_key: wire_id,
        event_source: {
          node_key: 'composio_gmail-new_gmail_message-1',
          trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
          connection_id: 'conn_test',
        },
        rules: [{ field: 'sender', operation: 'is_absent' }],
        job_input: { instruction: 'Pay it.' },
      },
      trigger_status: 'enabled',
      actor_id: bootstrap.user_id,
    });
    const body = JSON.stringify(gmail_envelope());
    const delivery = signed_delivery({ body, webhook_id: 'msg_shared_ear' });
    const app = create_app(db);

    const first = await app.request('/v1/triggers/deliveries/composio', delivery);
    const answer = (await first.json()).data;

    expect(first.status).toBe(202);
    expect(answer.fired).toBe(true);
    expect(answer.queued_job_count).toBe(2);
    expect(answer.fires.map((fire: { trigger_id: string }) => fire.trigger_id).sort()).toEqual(
      [trigger.trigger_id, second.trigger_id].sort(),
    );
    const recorded = await db.query.events.findMany({
      where: eq(events.workspace_id, bootstrap.workspace_id),
    });
    expect(recorded.map((event) => event.source_event_id).sort()).toEqual(
      [`${trigger.trigger_id}:msg_shared_ear`, `${second.trigger_id}:msg_shared_ear`].sort(),
    );

    const retry = await app.request('/v1/triggers/deliveries/composio', delivery);
    expect((await retry.json()).data.fired).toBe(false);
    expect(
      await db.query.events.findMany({ where: eq(events.workspace_id, bootstrap.workspace_id) }),
    ).toHaveLength(2);
  });

  it('fires once for a delivery, and the SAME webhook-id twice stays one event and one job', async () => {
    const db = await create_test_database();
    const { bootstrap, trigger } = await make_event_trigger(db);
    const app = create_app(db);
    const body = JSON.stringify(gmail_envelope());
    const delivery = signed_delivery({ body, webhook_id: 'msg_abc123' });

    const first = await app.request('/v1/triggers/deliveries/composio', delivery);
    const first_body = (await first.json()).data;
    const retry = await app.request('/v1/triggers/deliveries/composio', {
      ...delivery,
      headers: { ...delivery.headers },
    });
    const retry_body = (await retry.json()).data;

    expect(first.status).toBe(202);
    expect(first_body).toMatchObject({
      received: true,
      fired: true,
      trigger_id: trigger.trigger_id,
      queued_job_count: 1,
    });
    expect(retry.status).toBe(202);
    expect(retry_body).toMatchObject({ fired: false, event_id: first_body.event_id });

    const recorded = await db.query.events.findMany({
      where: eq(events.workspace_id, bootstrap.workspace_id),
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.source_event_id).toBe(`${trigger.trigger_id}:msg_abc123`);
    expect(recorded[0]?.event_body).toMatchObject({
      trigger_id: trigger.trigger_id,
      instruction: 'Draft a reply.',
      delivery: {
        provider: 'composio',
        trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
        received_time: '2026-09-15T09:04:12Z',
        data: { message_id: '18c2f9a44b' },
      },
    });
    expect(recorded[0]?.raw_payload).toMatchObject({
      id: 'msg_abc123',
      type: 'composio.trigger.message',
    });

    const jobs = await db.query.event_jobs.findMany({
      where: eq(event_jobs.workspace_id, bootstrap.workspace_id),
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.job_handler).toBe('run_automation');
  });

  it('still fires the automation when the brain crawl lookup hits a database error', async () => {
    const db = await create_test_database();
    const { bootstrap, trigger } = await make_event_trigger(db);
    await db
      .update(connections)
      .set({ provider_account: { connected_account_id: our_account_id } })
      .where(eq(connections.connection_id, 'conn_test'));
    await db.execute(sql`ALTER TABLE brain_sources RENAME TO brain_sources_offline`);
    const body = JSON.stringify(gmail_envelope());

    const response = await create_app(db).request(
      '/v1/triggers/deliveries/composio',
      signed_delivery({ body, webhook_id: 'msg_lookup_fails' }),
    );

    expect(response.status).toBe(202);
    expect((await response.json()).data).toMatchObject({
      fired: true,
      trigger_id: trigger.trigger_id,
      queued_job_count: 1,
    });
    const jobs = await db.query.event_jobs.findMany({
      where: eq(event_jobs.workspace_id, bootstrap.workspace_id),
    });
    expect(jobs.map((job) => job.job_handler)).toEqual(['run_automation']);
  });
});

describe('POST /v1/triggers/deliveries/webhook/:trigger_id', () => {
  async function webhook_ear(db: Db) {
    const bootstrap = await bootstrap_default_workspace(db);
    const trigger = await create_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_name: 'Anything on the web',
      trigger_type: 'webhook',
      trigger_config: {
        starts_job_handler: 'run_automation',
        webhook_secret: 'shh_0123456789abcdef',
      },
      automation_id: 'atm_web',
      actor_id: bootstrap.user_id,
    });
    return { bootstrap, trigger };
  }
  const post = (
    trigger_id: string,
    secret: string,
    body: string,
    extra: Record<string, string> = {},
  ) =>
    [
      `/v1/triggers/deliveries/webhook/${trigger_id}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secret}`,
          ...extra,
        },
        body,
      },
    ] as const;

  it('records one event per delivery and dedups a retry with the same idempotency key', async () => {
    const db = await create_test_database();
    const { trigger } = await webhook_ear(db);
    const app = create_app(db);
    const first = await app.request(
      ...post(trigger.trigger_id, 'shh_0123456789abcdef', '{"order_id":"o_1","total":42}', {
        'idempotency-key': 'k1',
      }),
    );
    expect(first.status).toBe(202);
    const body = (await first.json()) as { data: { fired: boolean; event_id: string } };
    expect(body.data.fired).toBe(true);
    const again = await app.request(
      ...post(trigger.trigger_id, 'shh_0123456789abcdef', '{"order_id":"o_1","total":42}', {
        'idempotency-key': 'k1',
      }),
    );
    expect(again.status).toBe(202);
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.workspace_id, trigger.workspace_id));
    expect(rows).toHaveLength(1);
    expect(
      (rows[0]?.event_body as { delivery: { provider: string; data: { order_id: string } } })
        .delivery,
    ).toMatchObject({ provider: 'webhook', data: { order_id: 'o_1' } });
  });

  it('fires on a form-encoded body and keeps the raw text as the delivery body', async () => {
    const db = await create_test_database();
    const { trigger } = await webhook_ear(db);
    const app = create_app(db);
    const response = await app.request(
      ...post(trigger.trigger_id, 'shh_0123456789abcdef', 'From=%2B15550100&Body=hello', {
        'content-type': 'application/x-www-form-urlencoded',
      }),
    );
    expect(response.status).toBe(202);
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.workspace_id, trigger.workspace_id));
    expect((rows[0]?.event_body as { delivery: { data: unknown } }).delivery.data).toEqual({
      body: 'From=%2B15550100&Body=hello',
    });
  });

  it('answers 401 to the wrong secret, a missing ear, and a non-webhook ear alike', async () => {
    const db = await create_test_database();
    const { trigger } = await webhook_ear(db);
    const app = create_app(db);
    expect((await app.request(...post(trigger.trigger_id, 'wrong', '{}'))).status).toBe(401);
    expect((await app.request(...post('trg_missing', 'shh_0123456789abcdef', '{}'))).status).toBe(
      401,
    );
    expect(
      (
        await app.request(`/v1/triggers/deliveries/webhook/${trigger.trigger_id}`, {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(401);
  });
});
