import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { trigger_wire_provisioners } from '@api/services/triggers/trigger_wire';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { claim_card_unlock } from '@coworker/core/db/queries/rewards_state';
import { set_user_timezone } from '@coworker/core/db/queries/user_timezone';
import {
  apps,
  connections,
  event_jobs,
  nodes,
  resource_grants,
  runs,
  workspaces,
} from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audit = { created_by: 'test', last_updated_by: 'test' };
const original_provisioner = trigger_wire_provisioners.composio;
const provider = {
  create: vi.fn(async () => ({ provisioning_key: 'wire_test' })),
  set_enabled: vi.fn(async (_input: { provisioning_key: string; enabled: boolean }) => {}),
  delete: vi.fn(async (_input: { provisioning_key: string }) => {}),
};

beforeEach(() => {
  vi.resetAllMocks();
  provider.create.mockResolvedValue({ provisioning_key: 'wire_test' });
  trigger_wire_provisioners.composio = provider;
});
afterEach(() => {
  trigger_wire_provisioners.composio = original_provisioner;
});

async function create_fixture(with_card = true) {
  const db = await create_test_database();
  const identity = await bootstrap_default_workspace(db);
  await db
    .update(workspaces)
    .set({
      created_time: new Date('2026-09-10T00:00:00Z'),
      last_updated_time: new Date(),
      ...audit,
    })
    .where(eq(workspaces.workspace_id, identity.workspace_id));
  if (with_card) await claim_card_unlock(db, identity.workspace_id);
  await db.insert(apps).values({
    app_id: 'app_wire',
    app_name: 'mail_fixture',
    app_key: 'mail_fixture',
    app_display_name: 'Mail fixture',
    ...audit,
  });
  await db.insert(nodes).values({
    node_id: 'node_wire',
    app_id: 'app_wire',
    app_key: 'mail_fixture',
    node_name: 'message_received',
    node_key: 'mail_fixture-message_received-1',
    node_display_name: 'Message received',
    node_kind: 'trigger',
    input_schema: {},
    runtime_handler: 'composio.trigger.MESSAGE_RECEIVED',
    node_config: { composio: { toolkit_slug: 'mail_fixture', trigger_slug: 'MESSAGE_RECEIVED' } },
    ...audit,
  });
  await db.insert(connections).values({
    connection_id: 'conn_wire',
    workspace_id: identity.workspace_id,
    app_id: 'app_wire',
    connection_key: 'mail_fixture',
    connection_status: 'active',
    external_account_id: 'account_wire',
    ...audit,
  });
  return { db, identity, app: create_app(db) };
}

const three_ears = {
  automation_name: 'Answer billing questions',
  instruction: 'Read the message and draft a reply.',
  run_policy: { subject_from: 'thread_id', when_a_run_is_already_going: 'wait_for_it_to_finish' },
  conditions: [],
  judge: { question: 'Is this a support ticket?', run_at_or_above: 60 },
  triggers: [
    { kind: 'schedule', cron: '0 9 * * 1-5', timezone: 'Europe/London' },
    {
      kind: 'app_event',
      node_key: 'mail_fixture-message_received-1',
      connection_id: 'conn_wire',
      subscription_config: { query: 'in:inbox' },
      conditions: [{ field: 'from', operation: 'does_not_contain_any_of', values: ['no-reply'] }],
    },
    { kind: 'manual' },
  ],
};

const unnamed_ears = {
  ...three_ears,
  triggers: three_ears.triggers.map(
    ({ connection_id: _, ...ear }: { connection_id?: string }) => ear,
  ),
};

function post_automation(app: ReturnType<typeof create_app>, body: unknown) {
  return app.request('/v1/automations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('automation api routes', () => {
  it('writes one automation and one trigger row per way it starts, and wires the app event', async () => {
    const fixture = await create_fixture();
    const response = await post_automation(fixture.app, three_ears);
    const created = (await response.json()).data;

    expect(response.status).toBe(201);
    expect(created.automation).toMatchObject({
      automation_name: 'Answer billing questions',
      automation_status: 'enabled',
      instruction_version: 1,
      run_policy: { subject_from: 'thread_id' },
    });
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger_slug: 'MESSAGE_RECEIVED',
        connected_account_id: 'account_wire',
        subscription_config: { query: 'in:inbox' },
      }),
    );
    const stored = await list_automation_triggers(fixture.db, {
      workspace_id: fixture.identity.workspace_id,
      automation_id: created.automation.automation_id,
    });
    expect(stored.map((trigger) => trigger.trigger_type).sort()).toEqual([
      'app_event',
      'manual',
      'schedule',
    ]);
    expect(stored.every((trigger) => trigger.trigger_status === 'enabled')).toBe(true);
    expect(stored.every((trigger) => !trigger.trigger_config.job_input)).toBe(true);
    const wired = stored.find((trigger) => trigger.trigger_type === 'app_event');
    expect(wired?.trigger_config).toMatchObject({
      starts_job_handler: 'run_automation',
      provisioned_by: 'composio',
      provisioning_key: 'wire_test',
      event_source: { trigger_slug: 'MESSAGE_RECEIVED', connection_id: 'conn_wire' },
      rules: [{ field: 'from', operation: 'does_not_contain_any_of', values: ['no-reply'] }],
    });
  });

  it('keeps the automation and its other ears alive when one wire fails', async () => {
    const fixture = await create_fixture();
    provider.create.mockRejectedValue(
      new Error(
        'Polling trigger "GMAIL_EMAIL_SENT_TRIGGER" requested an interval of 0.5 minutes, but the minimum polling interval for GMAIL is 1 minute.',
      ),
    );

    const response = await post_automation(fixture.app, three_ears);
    const created = (await response.json()).data;
    const stored = await list_automation_triggers(fixture.db, {
      workspace_id: fixture.identity.workspace_id,
      automation_id: created.automation.automation_id,
    });
    const failed = stored.find((trigger) => trigger.trigger_type === 'app_event');

    expect(response.status).toBe(201);
    expect(created.automation.automation_status).toBe('enabled');
    expect(failed?.trigger_status).toBe('error');
    expect(failed?.trigger_config.provisioning_error).toBe(
      'Polling trigger requested an interval of 0.5 minutes, but the minimum polling interval for GMAIL is 1 minute.',
    );
    expect(
      stored
        .filter((trigger) => trigger.trigger_type !== 'app_event')
        .every((trigger) => trigger.trigger_status === 'enabled'),
    ).toBe(true);
  });

  it('lists every automation with its run count and last run in one page', async () => {
    const fixture = await create_fixture();
    const created = (await (await post_automation(fixture.app, three_ears)).json()).data;
    const last_run_time = new Date('2026-09-14T08:00:00Z');
    await fixture.db.insert(runs).values({
      run_id: create_id(id_prefixes.run),
      workspace_id: fixture.identity.workspace_id,
      session_id: 'ses_none',
      agent_id: fixture.identity.agent_id,
      automation_id: created.automation.automation_id,
      run_status: 'succeeded',
      trigger_type: 'schedule',
      created_time: last_run_time,
      ...audit,
    });

    const listed = (await (await fixture.app.request('/v1/automations')).json()).data;

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      automation_id: created.automation.automation_id,
      run_count: 1,
    });
    expect(new Date(listed[0].last_run_time)).toEqual(last_run_time);
  });

  it('names the app of every app ear on the list and the detail, and none for the others', async () => {
    const fixture = await create_fixture();
    await fixture.db
      .update(apps)
      .set({ metadata: { icon_url: 'https://logos.example.com/mail.svg' } })
      .where(eq(apps.app_id, 'app_wire'));
    const created = (await (await post_automation(fixture.app, three_ears)).json()).data;
    const mail_app = {
      app_name: 'mail_fixture',
      app_display_name: 'Mail fixture',
      icon_url: 'https://logos.example.com/mail.svg',
    };
    const apps_by_kind = (triggers: Array<{ trigger_type: string; app: unknown }>) =>
      Object.fromEntries(triggers.map((trigger) => [trigger.trigger_type, trigger.app]));

    const listed = (await (await fixture.app.request('/v1/automations')).json()).data;
    const detail = (
      await (
        await fixture.app.request(`/v1/automations/${created.automation.automation_id}`)
      ).json()
    ).data;

    const expected = { schedule: null, app_event: mail_app, manual: null };
    expect(apps_by_kind(listed[0].triggers)).toEqual(expected);
    expect(apps_by_kind(detail.triggers)).toEqual(expected);
  });

  it('pauses every ear with the automation and takes the wires down on delete', async () => {
    const fixture = await create_fixture();
    const created = (await (await post_automation(fixture.app, three_ears)).json()).data;
    const identity = {
      workspace_id: fixture.identity.workspace_id,
      automation_id: created.automation.automation_id,
    };

    const paused = await fixture.app.request(`/v1/automations/${identity.automation_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automation_status: 'paused' }),
    });
    const after_pause = await list_automation_triggers(fixture.db, identity);
    expect((await paused.json()).data.automation.automation_status).toBe('paused');
    expect(after_pause.every((trigger) => trigger.trigger_status === 'disabled')).toBe(true);
    expect(provider.set_enabled).toHaveBeenCalledWith({
      provisioning_key: 'wire_test',
      enabled: false,
    });

    const deleted = await fixture.app.request(`/v1/automations/${identity.automation_id}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);
    expect(provider.delete).toHaveBeenCalledWith(
      expect.objectContaining({ provisioning_key: 'wire_test' }),
    );
    expect(await list_automation_triggers(fixture.db, identity)).toEqual([]);
    expect((await fixture.app.request(`/v1/automations/${identity.automation_id}`)).status).toBe(
      404,
    );
  });

  it('pauses an automation whose wire the provider says is already gone', async () => {
    const fixture = await create_fixture();
    const created = (await (await post_automation(fixture.app, three_ears)).json()).data;
    const identity = {
      workspace_id: fixture.identity.workspace_id,
      automation_id: created.automation.automation_id,
    };
    provider.set_enabled.mockRejectedValue(
      Object.assign(new Error('Trigger instance not found'), { status: 410 }),
    );

    const paused = await fixture.app.request(`/v1/automations/${identity.automation_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automation_status: 'paused' }),
    });
    const stored = await list_automation_triggers(fixture.db, identity);
    const wired = stored.find((trigger) => trigger.trigger_type === 'app_event');

    expect((await paused.json()).data.automation.automation_status).toBe('paused');
    expect(stored.every((trigger) => trigger.trigger_status === 'disabled')).toBe(true);
    expect(wired?.trigger_config.provisioning_error).toBe('The provider no longer has this wire.');
  });

  it('marks the one refusing ear and still pauses the automation and its siblings', async () => {
    const fixture = await create_fixture();
    const created = (await (await post_automation(fixture.app, three_ears)).json()).data;
    const identity = {
      workspace_id: fixture.identity.workspace_id,
      automation_id: created.automation.automation_id,
    };
    provider.set_enabled.mockRejectedValue(new Error('composio is down'));

    const paused = await fixture.app.request(`/v1/automations/${identity.automation_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automation_status: 'paused' }),
    });
    const stored = await list_automation_triggers(fixture.db, identity);
    const wired = stored.find((trigger) => trigger.trigger_type === 'app_event');

    expect(paused.status).toBe(200);
    expect((await paused.json()).data.automation.automation_status).toBe('paused');
    expect(wired?.trigger_status).toBe('error');
    expect(wired?.trigger_config.provisioning_error).toBe('composio is down');
    expect(
      stored
        .filter((trigger) => trigger.trigger_type !== 'app_event')
        .every((trigger) => trigger.trigger_status === 'disabled'),
    ).toBe(true);
  });

  it('deletes an automation whose wire is already gone, and says so ear by ear', async () => {
    const fixture = await create_fixture();
    const created = (await (await post_automation(fixture.app, three_ears)).json()).data;
    const identity = {
      workspace_id: fixture.identity.workspace_id,
      automation_id: created.automation.automation_id,
    };
    provider.delete.mockRejectedValue(
      Object.assign(new Error('Trigger instance not found'), { status: 404 }),
    );

    const deleted = await fixture.app.request(`/v1/automations/${identity.automation_id}`, {
      method: 'DELETE',
    });
    const answer = (await deleted.json()).data;

    expect(deleted.status).toBe(200);
    expect(answer.deleted).toBe(true);
    expect(answer.triggers).toHaveLength(3);
    expect(answer.triggers.every((outcome: { removed: boolean }) => outcome.removed)).toBe(true);
    expect(await list_automation_triggers(fixture.db, identity)).toEqual([]);
  });

  it('saves an automation for an app nobody has connected, with that ear waiting', async () => {
    const fixture = await create_fixture();
    await fixture.db.delete(connections).where(eq(connections.connection_id, 'conn_wire'));

    const response = await post_automation(fixture.app, unnamed_ears);
    const created = (await response.json()).data;
    const stored = await list_automation_triggers(fixture.db, {
      workspace_id: fixture.identity.workspace_id,
      automation_id: created.automation.automation_id,
    });
    const waiting = stored.find((trigger) => trigger.trigger_type === 'app_event');

    expect(response.status).toBe(201);
    expect(created.automation.automation_status).toBe('enabled');
    expect(provider.create).not.toHaveBeenCalled();
    expect(waiting?.trigger_status).toBe('error');
    expect(waiting?.trigger_config.needs_connection).toBe('Mail fixture');
    expect(waiting?.trigger_config.provisioning_error).toBe('needs Mail fixture connected');
    expect(
      stored
        .filter((trigger) => trigger.trigger_type !== 'app_event')
        .every((trigger) => trigger.trigger_status === 'enabled'),
    ).toBe(true);
  });

  it('wires the waiting ear once the app is connected', async () => {
    const fixture = await create_fixture();
    const conn_wire = eq(connections.connection_id, 'conn_wire');
    await fixture.db.update(connections).set({ connection_status: 'revoked' }).where(conn_wire);
    const created = (await (await post_automation(fixture.app, unnamed_ears)).json()).data;
    const identity = {
      workspace_id: fixture.identity.workspace_id,
      automation_id: created.automation.automation_id,
    };
    await fixture.db.update(connections).set({ connection_status: 'active' }).where(conn_wire);

    const provision_path = `/v1/automations/${identity.automation_id}/provision`;
    const response = await fixture.app.request(provision_path, { method: 'POST' });
    const stored = await list_automation_triggers(fixture.db, identity);
    const wired = stored.find((trigger) => trigger.trigger_type === 'app_event');

    expect(response.status).toBe(200);
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger_slug: 'MESSAGE_RECEIVED',
        connected_account_id: 'account_wire',
        subscription_config: { query: 'in:inbox' },
      }),
    );
    expect(wired?.trigger_status).toBe('enabled');
    expect(wired?.trigger_config.provisioning_key).toBe('wire_test');
    expect(wired?.trigger_config.needs_connection).toBeUndefined();
    expect(wired?.trigger_config.provisioning_error).toBeUndefined();
    expect(wired?.trigger_config.event_source?.connection_id).toBe('conn_wire');
  });

  it('leaves the waiting ear waiting when the app is still not connected', async () => {
    const fixture = await create_fixture();
    await fixture.db.delete(connections).where(eq(connections.connection_id, 'conn_wire'));
    const created = (await (await post_automation(fixture.app, unnamed_ears)).json()).data;

    const response = await fixture.app.request(
      `/v1/automations/${created.automation.automation_id}/provision`,
      { method: 'POST' },
    );
    const answered = (await response.json()).data;
    const waiting = answered.triggers.find(
      (trigger: { trigger_type: string }) => trigger.trigger_type === 'app_event',
    );

    expect(response.status).toBe(200);
    expect(provider.create).not.toHaveBeenCalled();
    expect(waiting.trigger_status).toBe('error');
    expect(waiting.trigger_config.needs_connection).toBe('Mail fixture');
  });

  it('runs a schedule that names no time zone in the zone of the person who made it', async () => {
    const fixture = await create_fixture();
    await set_user_timezone(fixture.db, {
      user_id: fixture.identity.user_id,
      timezone: 'Asia/Tokyo',
      actor_id: fixture.identity.user_id,
    });
    const no_zone = { ...three_ears, triggers: [{ kind: 'schedule', cron: '0 9 * * 1-5' }] };
    const named_zone = { ...three_ears, automation_name: 'Named zone' };

    const created = (await (await post_automation(fixture.app, no_zone)).json()).data;
    const with_name = (await (await post_automation(fixture.app, named_zone)).json()).data;
    const zone_of = (answer: { triggers: { trigger_type: string; trigger_config: object }[] }) =>
      answer.triggers.find((trigger) => trigger.trigger_type === 'schedule')?.trigger_config;

    expect(zone_of(created)).toMatchObject({ timezone: 'Asia/Tokyo' });
    expect(zone_of(with_name)).toMatchObject({ timezone: 'Europe/London' });
  });

  it('runs an automation now through a manual ear it grows on demand', async () => {
    const fixture = await create_fixture();
    const schedule_only = {
      ...three_ears,
      triggers: [{ kind: 'schedule', cron: '0 9 * * 1-5' }],
    };
    const created = (await (await post_automation(fixture.app, schedule_only)).json()).data;

    const response = await fixture.app.request(
      `/v1/automations/${created.automation.automation_id}/run-now`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occurrence_key: 'run_now_test' }),
      },
    );
    const fired = (await response.json()).data;
    const queued = await fixture.db.query.event_jobs.findMany({
      where: and(
        eq(event_jobs.workspace_id, fixture.identity.workspace_id),
        eq(event_jobs.job_handler, 'run_automation'),
      ),
    });
    const stored = await list_automation_triggers(fixture.db, {
      workspace_id: fixture.identity.workspace_id,
      automation_id: created.automation.automation_id,
    });

    expect(response.status).toBe(202);
    expect(fired.fired).toBe(true);
    expect(queued).toHaveLength(1);
    expect(stored.map((trigger) => trigger.trigger_type).sort()).toEqual(['manual', 'schedule']);
  });

  it('rejects an automation whose cron could never be scheduled', async () => {
    const fixture = await create_fixture();
    const response = await post_automation(fixture.app, {
      ...three_ears,
      triggers: [{ kind: 'schedule', cron: '99 99 99 99 99' }],
    });
    expect(response.status).toBe(422);
  });

  it('saves an automation live for a free workspace with no card on file', async () => {
    const fixture = await create_fixture(false);
    const created = (await (await post_automation(fixture.app, three_ears)).json()).data;
    const stored = await list_automation_triggers(fixture.db, {
      workspace_id: fixture.identity.workspace_id,
      automation_id: created.automation.automation_id,
    });

    expect(created.automation.automation_status).toBe('enabled');
    expect(stored.every((trigger) => trigger.trigger_status === 'enabled')).toBe(true);
  });

  it('refuses an automation that tries to choose its own delivery address', async () => {
    const fixture = await create_fixture();
    const response = await post_automation(fixture.app, {
      ...three_ears,
      email_to: 'someone@example.com',
    });
    expect(response.status).toBe(422);
  });

  it('refuses a caller that claims its automation came from the system', async () => {
    const fixture = await create_fixture();
    const refused = await post_automation(fixture.app, { ...three_ears, created_via: 'system' });
    expect(refused.status).toBe(422);

    const created = (await (await post_automation(fixture.app, three_ears)).json()).data;
    expect(created.automation.created_via).toBe('user');
  });

  it('refuses uses_tools on create and on edit', async () => {
    const fixture = await create_fixture();
    const uses_tools = { apps: ['mail_fixture'] };
    expect((await post_automation(fixture.app, { ...three_ears, uses_tools })).status).toBe(422);

    const created = (await (await post_automation(fixture.app, three_ears)).json()).data;
    const patched = await fixture.app.request(
      `/v1/automations/${created.automation.automation_id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uses_tools }),
      },
    );
    expect(patched.status).toBe(422);
  });

  it("refuses an ear on a teammate's private connection, and lets its owner save one", async () => {
    const fixture = await create_fixture();
    const restrict_to = async (connection_id: string, user_id: string) => {
      await fixture.db.insert(connections).values({
        connection_id,
        workspace_id: fixture.identity.workspace_id,
        app_id: 'app_wire',
        connection_key: connection_id,
        connection_status: 'active',
        external_account_id: `account_${connection_id}`,
        connected_by: user_id,
        ...audit,
      });
      await fixture.db.insert(resource_grants).values({
        resource_grant_id: create_id(id_prefixes.resource_grant),
        workspace_id: fixture.identity.workspace_id,
        resource_type: 'connection',
        resource_id: connection_id,
        grantee_type: 'user',
        grantee_id: user_id,
        grant_level: 'use',
        ...audit,
      });
    };
    await restrict_to('conn_teammate', 'user_teammate');
    await restrict_to('conn_mine', fixture.identity.user_id);
    const on = (connection_id: string) => ({
      ...three_ears,
      triggers: [{ ...(three_ears.triggers[1] as object), connection_id }],
    });

    const refused = await post_automation(fixture.app, on('conn_teammate'));
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.message).toBe(
      'That connection is private to somebody else.',
    );
    expect(provider.create).not.toHaveBeenCalled();

    const mine = await post_automation(fixture.app, on('conn_mine'));
    expect(mine.status).toBe(201);
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({ connection_id: 'conn_mine' }),
    );
  });

  it('takes the old wire down and opens a new one when an edit switches the account', async () => {
    const fixture = await create_fixture();
    await fixture.db.insert(connections).values({
      connection_id: 'conn_other',
      workspace_id: fixture.identity.workspace_id,
      app_id: 'app_wire',
      connection_key: 'mail_fixture_other',
      connection_status: 'active',
      external_account_id: 'account_other',
      ...audit,
    });
    const created = (await (await post_automation(fixture.app, three_ears)).json()).data;
    const mail_ear = three_ears.triggers[1] as Record<string, unknown>;
    const patch = (connection_id: string | undefined) =>
      fixture.app.request(`/v1/automations/${created.automation.automation_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggers: [{ ...mail_ear, connection_id }] }),
      });

    provider.create.mockClear();
    await patch(undefined);
    expect(provider.create).not.toHaveBeenCalled();

    provider.delete.mockClear();
    const switched = (await (await patch('conn_other')).json()).data;
    expect(provider.delete).toHaveBeenCalledTimes(1);
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_id: 'conn_other',
        connected_account_id: 'account_other',
      }),
    );
    expect(switched.triggers[0].trigger_config.event_source.connection_id).toBe('conn_other');
  });

  it('fires an automation trigger through the /v1/triggers/:trigger_id/fire alias', async () => {
    const fixture = await create_fixture();
    const created = (await (await post_automation(fixture.app, three_ears)).json()).data;
    const stored = await list_automation_triggers(fixture.db, {
      workspace_id: fixture.identity.workspace_id,
      automation_id: created.automation.automation_id,
    });
    const manual_trigger = stored.find((trigger) => trigger.trigger_type === 'manual');
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.set(
      proxy_auth_headers.secret,
      process.env.COWORKER_API_PROXY_SECRET ?? 'local-development-internal-api-secret',
    );

    const response = await fixture.app.request(`/v1/triggers/${manual_trigger?.trigger_id}/fire`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ occurrence_key: 'alias_test' }),
    });
    const fired = (await response.json()).data;

    expect(response.status).toBe(202);
    expect(fired).toMatchObject({ fired: true, trigger_id: manual_trigger?.trigger_id });
  });

  it('replaces the ears on PATCH with a full list, keeping the ones that did not change', async () => {
    const fixture = await create_fixture();
    const created = (await (await post_automation(fixture.app, three_ears)).json()).data;
    const before = await list_automation_triggers(fixture.db, {
      workspace_id: fixture.identity.workspace_id,
      automation_id: created.automation.automation_id,
    });
    const schedule_before = before.find((trigger) => trigger.trigger_type === 'schedule');

    const response = await fixture.app.request(
      `/v1/automations/${created.automation.automation_id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggers: [{ kind: 'schedule', cron: '0 9 * * 1-5', timezone: 'Europe/London' }],
        }),
      },
    );
    const updated = (await response.json()).data;

    expect(response.status).toBe(200);
    expect(
      updated.triggers.map((trigger: { trigger_type: string }) => trigger.trigger_type),
    ).toEqual(['schedule']);
    expect(updated.triggers[0].trigger_id).toBe(schedule_before?.trigger_id);
    expect(provider.delete).toHaveBeenCalledTimes(1);
    expect(provider.delete).toHaveBeenCalledWith(
      expect.objectContaining({ provisioning_key: 'wire_test' }),
    );

    provider.create.mockClear();
    const added = (
      await (
        await fixture.app.request(`/v1/automations/${created.automation.automation_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            triggers: [
              { kind: 'schedule', cron: '0 9 * * 1-5', timezone: 'Europe/London' },
              {
                kind: 'app_event',
                node_key: 'mail_fixture-message_received-1',
                subscription_config: { query: 'in:inbox' },
                conditions: [],
              },
            ],
          }),
        })
      ).json()
    ).data;
    expect(added.triggers.map((trigger: { trigger_type: string }) => trigger.trigger_type)).toEqual(
      ['schedule', 'app_event'],
    );
    expect(added.triggers[0].trigger_id).toBe(schedule_before?.trigger_id);
    expect(provider.create).toHaveBeenCalledTimes(1);
  });
});
