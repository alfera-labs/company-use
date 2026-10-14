import { createHmac } from 'node:crypto';
import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { events } from '@coworker/core/db/schema';
import { describe, expect, it } from 'vitest';

const older_plain_secret = 'a'.repeat(43);
const provider_signing_secret = 'signing_secret_a_provider_gave_0123456789';

async function create_fixture() {
  const db = await create_test_database();
  const identity = await bootstrap_default_workspace(db);
  return { db, identity, app: create_app(db) };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;
type AnsweredTrigger = {
  trigger_id: string;
  trigger_type: string;
  new_webhook_secret?: string;
  trigger_config: Record<string, unknown>;
};

function send(fixture: Fixture, method: string, path: string, body?: unknown) {
  return fixture.app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function create_web_call_automation(fixture: Fixture) {
  const response = await send(fixture, 'POST', '/v1/automations', {
    automation_name: 'Orders from the shop',
    instruction: 'Read the order and file it.',
    triggers: [{ kind: 'webhook' }],
  });
  const created = (await response.json()).data as {
    automation: { automation_id: string };
    triggers: AnsweredTrigger[];
  };
  const [trigger] = created.triggers;
  const secret = trigger?.new_webhook_secret ?? trigger?.trigger_config.webhook_secret;
  if (!trigger || typeof secret !== 'string') throw new Error('creation did not show a secret');
  return { response, created, trigger, secret };
}

async function seed_older_rows(fixture: Fixture) {
  const { db, identity } = fixture;
  const automation = await create_automation(db, {
    workspace_id: identity.workspace_id,
    agent_id: identity.agent_id,
    automation_name: 'Made before secrets were hidden',
    instruction: 'File what arrives.',
    actor_id: identity.user_id,
  });
  const shared = {
    workspace_id: identity.workspace_id,
    agent_id: identity.agent_id,
    automation_id: automation.automation_id,
    actor_id: identity.user_id,
  };
  const web_call = await create_trigger(db, {
    ...shared,
    trigger_name: 'An older web call',
    trigger_type: 'webhook',
    trigger_config: { starts_job_handler: 'run_automation', webhook_secret: older_plain_secret },
  });
  const crm = await create_trigger(db, {
    ...shared,
    trigger_name: 'New records',
    trigger_type: 'app_event',
    trigger_config: {
      starts_job_handler: 'run_automation',
      provisioned_by: 'attio',
      provisioning_key: 'wh_exposure',
      webhook_secret: provider_signing_secret,
      event_source: { node_key: 'attio-record_created-1', trigger_slug: 'record.created' },
    },
  });
  return { automation, web_call, crm };
}

async function read_every_answer(fixture: Fixture, automation_id: string) {
  const path = `/v1/automations/${automation_id}`;
  const answers = [
    await send(fixture, 'GET', '/v1/automations'),
    await send(fixture, 'GET', path),
    await send(fixture, 'GET', '/v1/triggers'),
    await send(fixture, 'PATCH', path, { automation_name: 'Renamed' }),
    await send(fixture, 'PATCH', path, { automation_status: 'paused' }),
    await send(fixture, 'PATCH', path, { automation_status: 'enabled' }),
    await send(fixture, 'POST', `${path}/provision`),
  ];
  for (const answer of answers) expect(answer.status).toBe(200);
  return (await Promise.all(answers.map((answer) => answer.text()))).join('\n');
}

function deliver(fixture: Fixture, trigger_id: string, secret: string) {
  return fixture.app.request(`/v1/triggers/deliveries/webhook/${trigger_id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: '{"order":1}',
  });
}

describe('the secret of a web-call trigger', () => {
  it('is shown by the call that makes the trigger, is stored only as a hash, and opens the address', async () => {
    const fixture = await create_fixture();

    const { response, trigger, secret } = await create_web_call_automation(fixture);
    const stored = await get_trigger_by_id(fixture.db, trigger.trigger_id);
    const delivered = await deliver(fixture, trigger.trigger_id, secret);

    expect(response.status).toBe(201);
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(trigger.new_webhook_secret).toBe(secret);
    expect(trigger.trigger_config).not.toHaveProperty('webhook_secret');
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(stored?.trigger_config.webhook_secret).toBeUndefined();
    expect(stored?.trigger_config.webhook_secret_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(trigger.trigger_config).not.toHaveProperty('webhook_secret_hash');
    expect(delivered.status).toBe(202);
    expect((await deliver(fixture, trigger.trigger_id, `${secret}0`)).status).toBe(401);
  });

  it('is in no answer after the one that made it', async () => {
    const fixture = await create_fixture();
    const { created, secret } = await create_web_call_automation(fixture);

    const every_answer = await read_every_answer(fixture, created.automation.automation_id);

    expect(every_answer).not.toContain(secret);
    expect(every_answer).not.toContain('new_webhook_secret');
    expect(every_answer).not.toContain('webhook_secret_hash');
  });

  it('is shown only for the trigger an edit adds, never for one that was already there', async () => {
    const fixture = await create_fixture();
    const response = await send(fixture, 'POST', '/v1/automations', {
      automation_name: 'Orders from the shop',
      instruction: 'Read the order and file it.',
      triggers: [{ kind: 'manual' }],
    });
    const automation_id = (await response.json()).data.automation.automation_id as string;
    const path = `/v1/automations/${automation_id}`;

    const added = await send(fixture, 'PATCH', path, {
      triggers: [{ kind: 'manual' }, { kind: 'webhook' }],
    });
    const added_triggers = (await added.json()).data.triggers as AnsweredTrigger[];
    const web_call = added_triggers.find((trigger) => trigger.trigger_type === 'webhook');
    const edited_again = await send(fixture, 'PATCH', path, {
      triggers: [{ kind: 'manual' }, { kind: 'webhook' }],
      instruction: 'Read the order, file it, and say so.',
    });

    expect(web_call?.new_webhook_secret).toMatch(/^[a-f0-9]{64}$/);
    expect(added_triggers.filter((trigger) => trigger.new_webhook_secret)).toHaveLength(1);
    expect(await edited_again.text()).not.toContain(web_call?.new_webhook_secret);
    expect(
      (await deliver(fixture, web_call?.trigger_id ?? '', web_call?.new_webhook_secret ?? ''))
        .status,
    ).toBe(202);
  });
});

describe('the secrets of rows made before this', () => {
  it('leaves the plain secret of an older web-call trigger out of every answer', async () => {
    const fixture = await create_fixture();
    const { automation } = await seed_older_rows(fixture);

    const every_answer = await read_every_answer(fixture, automation.automation_id);

    expect(every_answer).toContain('An older web call');
    expect(every_answer).not.toContain(older_plain_secret);
  });

  it('leaves the signing secret a provider gave out of every answer', async () => {
    const fixture = await create_fixture();
    const { automation } = await seed_older_rows(fixture);

    const every_answer = await read_every_answer(fixture, automation.automation_id);

    expect(every_answer).toContain('New records');
    expect(every_answer).not.toContain(provider_signing_secret);
  });

  it('still fires an older web-call trigger with the secret its owner was given', async () => {
    const fixture = await create_fixture();
    const { web_call } = await seed_older_rows(fixture);

    const delivered = await deliver(fixture, web_call.trigger_id, older_plain_secret);

    expect(delivered.status).toBe(202);
    expect(await fixture.db.select().from(events)).toHaveLength(1);
  });

  it('still checks a provider delivery against the signing secret after every answer hid it', async () => {
    const fixture = await create_fixture();
    const { automation, crm } = await seed_older_rows(fixture);
    await read_every_answer(fixture, automation.automation_id);
    const body = JSON.stringify({
      events: [{ event_type: 'record.created', id: { record_id: 'rec_1' } }],
    });

    const delivered = await fixture.app.request(`/v1/triggers/deliveries/attio/${crm.trigger_id}`, {
      method: 'POST',
      headers: {
        'attio-signature': createHmac('sha256', provider_signing_secret).update(body).digest('hex'),
      },
      body,
    });

    expect(delivered.status).toBe(202);
  });
});

describe('PATCH /v1/triggers/:trigger_id', () => {
  it('cannot give a web-call trigger a secret of the caller’s choosing', async () => {
    const fixture = await create_fixture();
    const { web_call } = await seed_older_rows(fixture);

    const patched = await send(fixture, 'PATCH', `/v1/triggers/${web_call.trigger_id}`, {
      trigger_config: { webhook_secret: 'a_secret_the_caller_chose' },
    });

    expect(patched.status).toBe(200);
    expect((await deliver(fixture, web_call.trigger_id, 'a_secret_the_caller_chose')).status).toBe(
      401,
    );
    expect((await deliver(fixture, web_call.trigger_id, older_plain_secret)).status).toBe(202);
  });

  it('cannot replace the hash of a new web-call trigger either', async () => {
    const fixture = await create_fixture();
    const { trigger, secret } = await create_web_call_automation(fixture);

    await send(fixture, 'PATCH', `/v1/triggers/${trigger.trigger_id}`, {
      trigger_config: {
        webhook_secret: 'a_secret_the_caller_chose',
        webhook_secret_hash: 'a'.repeat(64),
      },
    });

    expect((await deliver(fixture, trigger.trigger_id, 'a_secret_the_caller_chose')).status).toBe(
      401,
    );
    expect((await deliver(fixture, trigger.trigger_id, secret)).status).toBe(202);
  });
});
