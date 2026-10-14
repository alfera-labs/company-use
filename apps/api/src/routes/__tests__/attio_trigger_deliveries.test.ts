import { createHash, createHmac } from 'node:crypto';
import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { events } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

type Db = Awaited<ReturnType<typeof create_test_database>>;

const webhook_secret = 'attio_webhook_test_secret';
const people_object_id = '97052eb9-e65e-443f-a297-f2d9a4a7f795';
const companies_object_id = '0b1e4f6a-2f2c-4f6a-9d3e-6a1c2b3d4e5f';

function record_event(record_id: string, object_id = people_object_id) {
  return {
    event_type: 'record.created',
    id: { workspace_id: 'ws_attio', object_id, record_id },
    actor: { type: 'workspace-member', id: 'mem_1' },
  };
}

function signed_delivery(input: {
  body: string;
  idempotency_key: string;
  secret?: string | undefined;
}) {
  const signature = createHmac('sha256', input.secret ?? webhook_secret)
    .update(input.body)
    .digest('hex');
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'attio-signature': signature,
      'idempotency-key': input.idempotency_key,
    },
    body: input.body,
  };
}

async function make_attio_trigger(
  db: Db,
  overrides: { trigger_status?: 'enabled' | 'disabled'; attio_object_id?: string } = {},
) {
  const bootstrap = await bootstrap_default_workspace(db);
  const trigger = await create_trigger(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    trigger_name: 'New people in the CRM',
    trigger_type: 'app_event',
    trigger_config: {
      starts_job_handler: 'run_automation',
      provisioned_by: 'attio',
      provisioning_key: 'wh_1234',
      webhook_secret,
      ...(overrides.attio_object_id ? { attio_object_id: overrides.attio_object_id } : {}),
      event_source: {
        node_key: 'attio-record_created-1',
        trigger_slug: 'record.created',
        connection_id: 'conn_attio',
      },
      rules: [{ field: 'record_id', operation: 'is_absent' }],
      job_input: { instruction: 'Say hello.' },
    },
    trigger_status: overrides.trigger_status ?? 'enabled',
    actor_id: bootstrap.user_id,
  });
  return { bootstrap, trigger };
}

describe('POST /v1/triggers/deliveries/attio/:trigger_id', () => {
  it('fires one event and one job per event in the delivery, and a retry adds neither', async () => {
    const db = await create_test_database();
    const { bootstrap, trigger } = await make_attio_trigger(db);
    const app = create_app(db);
    const body = JSON.stringify({
      webhook_id: 'wh_1234',
      events: [record_event('rec_1'), record_event('rec_2')],
    });
    const delivery = signed_delivery({ body, idempotency_key: 'idem_two_events' });

    const response = await app.request(
      `/v1/triggers/deliveries/attio/${trigger.trigger_id}`,
      delivery,
    );
    const answer = (await response.json()).data;

    expect(response.status).toBe(202);
    expect(answer.fired).toBe(true);
    expect(answer.queued_job_count).toBe(2);

    const recorded = await db.query.events.findMany({
      where: eq(events.workspace_id, bootstrap.workspace_id),
    });
    expect(recorded).toHaveLength(2);
    const body_hash = createHash('sha256').update(body).digest('hex');
    expect(recorded.map((event) => event.source_event_id).sort()).toEqual([
      `${trigger.trigger_id}:${body_hash}:0`,
      `${trigger.trigger_id}:${body_hash}:1`,
    ]);
    expect(recorded[0]?.event_body).toMatchObject({
      delivery: {
        provider: 'attio',
        trigger_slug: 'record.created',
        data: {
          record_id: 'rec_1',
          object_id: people_object_id,
          event_type: 'record.created',
          actor_type: 'workspace-member',
          actor_id: 'mem_1',
        },
      },
    });
    expect(await db.query.event_jobs.findMany()).toHaveLength(2);

    const retry = await app.request(
      `/v1/triggers/deliveries/attio/${trigger.trigger_id}`,
      delivery,
    );
    expect((await retry.json()).data.fired).toBe(false);
    expect(
      await db.query.events.findMany({ where: eq(events.workspace_id, bootstrap.workspace_id) }),
    ).toHaveLength(2);
    expect(await db.query.event_jobs.findMany()).toHaveLength(2);
  });

  it('answers 401 to a body signed with the wrong secret', async () => {
    const db = await create_test_database();
    const { trigger } = await make_attio_trigger(db);
    const body = JSON.stringify({ webhook_id: 'wh_1234', events: [record_event('rec_1')] });

    const response = await create_app(db).request(
      `/v1/triggers/deliveries/attio/${trigger.trigger_id}`,
      signed_delivery({ body, idempotency_key: 'idem_bad', secret: 'not_the_secret' }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('invalid_signature');
    expect(await db.query.events.findMany()).toHaveLength(0);
  });

  it('answers 200 trigger_disabled without queuing work', async () => {
    const db = await create_test_database();
    const { trigger } = await make_attio_trigger(db, { trigger_status: 'disabled' });
    const body = JSON.stringify({ webhook_id: 'wh_1234', events: [record_event('rec_1')] });

    const response = await create_app(db).request(
      `/v1/triggers/deliveries/attio/${trigger.trigger_id}`,
      signed_delivery({ body, idempotency_key: 'idem_disabled' }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ received: false, reason: 'trigger_disabled' });
    expect(await db.query.event_jobs.findMany()).toHaveLength(0);
  });

  it('fires nothing when the ear listens to companies and a person arrives', async () => {
    const db = await create_test_database();
    const { trigger } = await make_attio_trigger(db, { attio_object_id: companies_object_id });
    const body = JSON.stringify({ webhook_id: 'wh_1234', events: [record_event('rec_1')] });

    const response = await create_app(db).request(
      `/v1/triggers/deliveries/attio/${trigger.trigger_id}`,
      signed_delivery({ body, idempotency_key: 'idem_wrong_object' }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ received: false, reason: 'no_matching_event' });
    expect(await db.query.events.findMany()).toHaveLength(0);
  });

  it('fires the record that IS the object the ear listens to', async () => {
    const db = await create_test_database();
    const { trigger } = await make_attio_trigger(db, { attio_object_id: companies_object_id });
    const body = JSON.stringify({
      webhook_id: 'wh_1234',
      events: [record_event('rec_acme', companies_object_id)],
    });

    const response = await create_app(db).request(
      `/v1/triggers/deliveries/attio/${trigger.trigger_id}`,
      signed_delivery({ body, idempotency_key: 'idem_right_object' }),
    );

    expect(response.status).toBe(202);
    expect((await response.json()).data.fired).toBe(true);
  });
});
