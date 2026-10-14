import { createHmac } from 'node:crypto';
import { vi } from 'vitest';

const { install_secret } = vi.hoisted(() => {
  const secret = 'install_wide_test_secret';
  process.env.COMPOSIO_WEBHOOK_SECRET = secret;
  return { install_secret: secret };
});

import { create_app } from '@api/app';
import {
  forget_trigger_delivery_counts,
  trigger_deliveries_per_window,
} from '@api/lib/trigger_delivery_rate_limit';
import {
  app_delivery_body_byte_limit,
  trigger_delivery_body_byte_limit,
} from '@api/routes/trigger_deliveries';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { events } from '@coworker/core/db/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type Db = Awaited<ReturnType<typeof create_test_database>>;

const crm_signing_secret = 'crm_signing_test_secret';
const web_call_secret = 'web_call_test_secret_0123456789';

async function make_crm_trigger(db: Db) {
  const bootstrap = await bootstrap_default_workspace(db);
  return create_trigger(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    trigger_name: 'New records',
    trigger_type: 'app_event',
    trigger_config: {
      starts_job_handler: 'run_automation',
      provisioned_by: 'attio',
      provisioning_key: 'wh_limits',
      webhook_secret: crm_signing_secret,
      event_source: { node_key: 'attio-record_created-1', trigger_slug: 'record.created' },
      job_input: { instruction: 'Say hello.' },
    },
    actor_id: bootstrap.user_id,
  });
}

async function make_web_call_trigger(
  db: Db,
  input: { secret?: string; trigger_status?: 'enabled' | 'disabled' } = {},
) {
  const bootstrap = await bootstrap_default_workspace(db);
  return create_trigger(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    trigger_name: 'A web call',
    trigger_type: 'webhook',
    trigger_config: {
      starts_job_handler: 'run_automation',
      webhook_secret: input.secret ?? web_call_secret,
    },
    trigger_status: input.trigger_status ?? 'enabled',
    actor_id: bootstrap.user_id,
  });
}

function crm_event(event_type: string, record_id: string) {
  return {
    event_type,
    id: { workspace_id: 'ws_crm', object_id: 'obj_people', record_id },
    actor: { type: 'workspace-member', id: 'mem_1' },
  };
}

function crm_delivery(input: { body: string; idempotency_key?: string; signature?: string }) {
  const signature =
    input.signature ?? createHmac('sha256', crm_signing_secret).update(input.body).digest('hex');
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'attio-signature': signature } : {}),
      ...(input.idempotency_key ? { 'idempotency-key': input.idempotency_key } : {}),
    },
    body: input.body,
  };
}

function web_call(secret: string, body: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body,
  };
}

const crm_path = (trigger_id: string) => `/v1/triggers/deliveries/attio/${trigger_id}`;
const web_call_path = (trigger_id: string) => `/v1/triggers/deliveries/webhook/${trigger_id}`;

beforeEach(() => {
  forget_trigger_delivery_counts();
});

describe('a signed CRM delivery sent again', () => {
  it('fires once when a copy of a signed "created" body arrives under a new Idempotency-Key', async () => {
    const db = await create_test_database();
    const trigger = await make_crm_trigger(db);
    const app = create_app(db);
    const body = JSON.stringify({ events: [crm_event('record.created', 'rec_1')] });

    const first = await app.request(
      crm_path(trigger.trigger_id),
      crm_delivery({ body, idempotency_key: 'the_real_delivery' }),
    );
    const copy = await app.request(
      crm_path(trigger.trigger_id),
      crm_delivery({ body, idempotency_key: 'a_key_the_sender_made_up' }),
    );

    expect(first.status).toBe(202);
    expect((await first.json()).data.fired).toBe(true);
    expect((await copy.json()).data.fired).toBe(false);
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it('still fires both of two real changes to one record, which arrive as the same bytes', async () => {
    const db = await create_test_database();
    const trigger = await make_crm_trigger(db);
    const app = create_app(db);
    const body = JSON.stringify({ events: [crm_event('record.updated', 'rec_1')] });

    const first_change = await app.request(
      crm_path(trigger.trigger_id),
      crm_delivery({ body, idempotency_key: 'first_change' }),
    );
    const second_change = await app.request(
      crm_path(trigger.trigger_id),
      crm_delivery({ body, idempotency_key: 'second_change' }),
    );

    expect((await first_change.json()).data.fired).toBe(true);
    expect((await second_change.json()).data.fired).toBe(true);
    expect(await db.select().from(events)).toHaveLength(2);
  });

  it('answers 401 to a delivery with no signature header', async () => {
    const db = await create_test_database();
    const trigger = await make_crm_trigger(db);
    const body = JSON.stringify({ events: [crm_event('record.created', 'rec_1')] });

    const response = await create_app(db).request(
      crm_path(trigger.trigger_id),
      crm_delivery({ body, idempotency_key: 'unsigned', signature: '' }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('invalid_signature');
    expect(await db.select().from(events)).toHaveLength(0);
  });
});

describe('a web-call delivery', () => {
  it('answers 200 and starts nothing when the trigger is paused', async () => {
    const db = await create_test_database();
    const trigger = await make_web_call_trigger(db, { trigger_status: 'disabled' });

    const response = await create_app(db).request(
      web_call_path(trigger.trigger_id),
      web_call(web_call_secret, '{"order":1}'),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ received: false, reason: 'trigger_disabled' });
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('answers 401 when the secret of one trigger is presented to another trigger', async () => {
    const db = await create_test_database();
    await make_web_call_trigger(db, { secret: 'a'.repeat(43) });
    const trigger_b = await make_web_call_trigger(db, {
      secret: 'b'.repeat(43),
    });

    const response = await create_app(db).request(
      web_call_path(trigger_b.trigger_id),
      web_call('the_secret_of_trigger_a_0123456789', '{"order":1}'),
    );

    expect(response.status).toBe(401);
    expect(await db.select().from(events)).toHaveLength(0);
  });
});

describe('the size of a delivery', () => {
  const just_over = (limit: number) => JSON.stringify({ padding: 'x'.repeat(limit) });

  it('answers 413 to a web call over the cap, even with the right secret', async () => {
    const db = await create_test_database();
    const trigger = await make_web_call_trigger(db);

    const response = await create_app(db).request(
      web_call_path(trigger.trigger_id),
      web_call(web_call_secret, just_over(trigger_delivery_body_byte_limit)),
    );

    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('delivery_too_large');
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('answers 413 to a CRM delivery over the cap, even when it is signed', async () => {
    const db = await create_test_database();
    const trigger = await make_crm_trigger(db);
    const body = JSON.stringify({
      events: [crm_event('record.created', 'rec_1')],
      padding: 'x'.repeat(trigger_delivery_body_byte_limit),
    });

    const response = await create_app(db).request(
      crm_path(trigger.trigger_id),
      crm_delivery({ body, idempotency_key: 'too_large' }),
    );

    expect(response.status).toBe(413);
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('answers 413 to an app delivery over its own cap before the signature is checked', async () => {
    const db = await create_test_database();
    const body = just_over(app_delivery_body_byte_limit);

    const response = await create_app(db).request('/v1/triggers/deliveries/composio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    expect(response.status).toBe(413);
  });

  it('refuses an over-cap body that names no length, without reading all of it', async () => {
    const db = await create_test_database();
    const trigger = await make_web_call_trigger(db);
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
    const chunks_in_the_body = (4 * trigger_delivery_body_byte_limit) / chunk.byteLength;
    let chunks_read = 0;
    const body_with_no_length = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunks_read === chunks_in_the_body) return controller.close();
        chunks_read += 1;
        controller.enqueue(chunk);
      },
    });

    const response = await create_app(db).request(web_call_path(trigger.trigger_id), {
      method: 'POST',
      headers: { authorization: `Bearer ${web_call_secret}` },
      body: body_with_no_length,
      duplex: 'half',
    } as RequestInit);

    expect(response.status).toBe(413);
    expect(chunks_read * chunk.byteLength).toBeLessThan(trigger_delivery_body_byte_limit * 2);
  });
});

describe('the rate of deliveries to one trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-13T10:00:30Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function fill_the_window(app: ReturnType<typeof create_app>, path: string) {
    for (let sent = 0; sent < trigger_deliveries_per_window; sent += 1) {
      await app.request(path, { method: 'POST', body: '{}' });
    }
  }

  it('answers 429 to a web call past the limit, and lets it through in the next window', async () => {
    const db = await create_test_database();
    const trigger = await make_web_call_trigger(db);
    const app = create_app(db);
    const path = web_call_path(trigger.trigger_id);
    await fill_the_window(app, path);

    const refused = await app.request(path, web_call(web_call_secret, '{"order":1}'));
    vi.setSystemTime(new Date('2026-10-13T10:01:30Z'));
    const next_window = await app.request(path, web_call(web_call_secret, '{"order":1}'));

    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe('rate_limited');
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(next_window.status).toBe(202);
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it('counts each trigger on its own, so a flood on one does not stop another', async () => {
    const db = await create_test_database();
    const flooded = await make_web_call_trigger(db);
    const quiet = await make_web_call_trigger(db);
    const app = create_app(db);
    await fill_the_window(app, web_call_path(flooded.trigger_id));

    const response = await app.request(
      web_call_path(quiet.trigger_id),
      web_call(web_call_secret, '{"order":1}'),
    );

    expect(response.status).toBe(202);
  });

  it('answers 429 to a signed CRM delivery past the limit', async () => {
    const db = await create_test_database();
    const trigger = await make_crm_trigger(db);
    const app = create_app(db);
    await fill_the_window(app, crm_path(trigger.trigger_id));
    const body = JSON.stringify({ events: [crm_event('record.created', 'rec_1')] });

    const refused = await app.request(
      crm_path(trigger.trigger_id),
      crm_delivery({ body, idempotency_key: 'past_the_limit' }),
    );

    expect(refused.status).toBe(429);
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('keeps answering signed app deliveries after a flood of unsigned ones', async () => {
    const db = await create_test_database();
    const app = create_app(db);
    const body = JSON.stringify({
      id: 'msg_1',
      type: 'composio.trigger.message',
      metadata: { trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE', trigger_id: 'ti_nobody' },
      data: {},
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', install_secret)
      .update(`msg_1.${timestamp}.${body}`)
      .digest('base64');
    for (let sent = 0; sent < trigger_deliveries_per_window + 1; sent += 1) {
      await app.request('/v1/triggers/deliveries/composio', { method: 'POST', body: '{}' });
    }

    const signed = await app.request('/v1/triggers/deliveries/composio', {
      method: 'POST',
      headers: {
        'webhook-id': 'msg_1',
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${signature}`,
      },
      body,
    });

    expect(signed.status).toBe(200);
    expect((await signed.json()).data).toMatchObject({ received: false });
  });
});

describe('an app-event trigger with no connection of its own', () => {
  const made_up_wire = 'ti_made_up_by_a_member';
  const wire_config = {
    starts_job_handler: 'run_automation',
    provisioned_by: 'composio',
    provisioning_key: made_up_wire,
    event_source: { node_key: 'alfera_email-message_received-1' },
  };

  function signed_app_delivery(body: string, webhook_id: string) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', install_secret)
      .update(`${webhook_id}.${timestamp}.${body}`)
      .digest('base64');
    return {
      method: 'POST',
      headers: {
        'webhook-id': webhook_id,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${signature}`,
      },
      body,
    };
  }

  it('cannot be made or re-pointed through the trigger routes, so no member can aim a delivery at one', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = create_app(db);
    const json = { 'content-type': 'application/json' };

    const made = await app.request('/v1/triggers', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        trigger_name: 'Aimed at a wire',
        trigger_type: 'app_event',
        trigger_config: wire_config,
      }),
    });
    const trigger_id = (await made.json()).data?.trigger_id as string | undefined;
    await app.request(`/v1/triggers/${trigger_id}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ trigger_config: wire_config }),
    });
    const stored = await db.query.triggers.findMany();
    const delivered = await app.request(
      '/v1/triggers/deliveries/composio',
      signed_app_delivery(
        JSON.stringify({
          id: 'msg_aimed',
          type: 'composio.trigger.message',
          metadata: { trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE', trigger_id: made_up_wire },
          data: {},
        }),
        'msg_aimed',
      ),
    );

    expect(made.status).toBe(201);
    expect(stored.map((trigger) => trigger.trigger_id)).toContain(trigger_id);
    expect(stored.map((trigger) => trigger.trigger_config.provisioning_key)).not.toContain(
      made_up_wire,
    );
    expect(stored.map((trigger) => trigger.trigger_config.provisioned_by)).not.toContain(
      'composio',
    );
    expect((await delivered.json()).data).toMatchObject({ received: false });
    expect(await db.select().from(events)).toHaveLength(0);
  });
});
