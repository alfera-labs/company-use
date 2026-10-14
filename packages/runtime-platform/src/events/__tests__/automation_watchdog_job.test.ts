import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_notifications_page } from '@coworker/core/db/queries/notification_outcomes';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { apps, automations, connections, events, nodes, triggers } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type WireHealthModule = typeof import('@runtime-platform/automations/trigger_wire_health');
const record_dead_wire = vi.fn<WireHealthModule['record_dead_wire']>();
vi.mock('@runtime-platform/automations/trigger_wire_health', async (import_original) => {
  const original = await import_original<WireHealthModule>();
  return { ...original, record_dead_wire };
});

const deliver_to_person = vi.fn(async () => ({
  delivered_on: 'slack_dm' as const,
  delivery_ref: 'D1:1',
  delivery_error: null,
}));
vi.mock('@runtime-platform/delivery/deliver_to_person', async (import_original) => ({
  ...(await import_original<typeof import('@runtime-platform/delivery/deliver_to_person')>()),
  deliver_to_person,
}));

const { create_composio_client } = await import('@runtime-platform/composio/composio_client');
const { list_composio_trigger_instances } = await import(
  '@runtime-platform/composio/composio_triggers'
);
const { run_automation_watchdog_job } = await import(
  '@runtime-platform/events/automation_watchdog_job'
);

type Db = Awaited<ReturnType<typeof create_test_database>>;

const now = new Date('2026-09-15T09:00:00Z');
const four_days_ago = new Date('2026-09-11T09:00:00Z');

let db: Db;
let workspace_id: string;
let agent_id: string;
let user_id: string;
let fired_event: typeof events.$inferSelect;

beforeEach(async () => {
  deliver_to_person.mockClear();
  const wire_health = await vi.importActual<WireHealthModule>(
    '@runtime-platform/automations/trigger_wire_health',
  );
  record_dead_wire.mockReset();
  record_dead_wire.mockImplementation(wire_health.record_dead_wire);
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  workspace_id = bootstrap.workspace_id;
  agent_id = bootstrap.agent_id;
  user_id = bootstrap.user_id;

  await db.insert(automations).values({
    automation_id: 'atm_billing',
    workspace_id,
    agent_id,
    automation_name: 'Billing questions',
    automation_status: 'enabled',
    instruction: 'Draft a reply.',
    run_policy: { subject_from: 'thread_id', when_a_run_is_already_going: 'wait_for_it_to_finish' },
    conditions: [],
    judge: null,
    uses_tools: { apps: ['gmail'] },
    created_via: 'user',
    created_by: user_id,
    last_updated_by: user_id,
  });

  await seed_gmail_trigger_node();

  const watchdog_trigger = await create_trigger(db, {
    workspace_id,
    agent_id,
    trigger_name: 'Automation watchdog',
    trigger_type: 'schedule',
    schedule_expression: '3,33 * * * *',
    trigger_config: {
      starts_job_handler: 'run_automation_watchdog',
      provisioning_key: 'automation_watchdog_v1',
    },
    trigger_source: { kind: 'system', source: 'test', purpose: 'automation_watchdog' },
    actor_id: user_id,
  });
  const [row] = await db
    .insert(events)
    .values({
      event_id: 'evt_watchdog_fire',
      workspace_id,
      source: 'trigger',
      source_event_id: `${watchdog_trigger.trigger_id}:2026-09-15T09:00`,
      event_type: 'trigger.fired',
      queue_key: `trigger:${watchdog_trigger.trigger_id}`,
      actor_key: 'system:trigger',
      event_body: { trigger_id: watchdog_trigger.trigger_id },
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    })
    .returning();
  if (!row) throw new Error('the fire event was not seeded');
  fired_event = row;
});

async function seed_gmail_trigger_node() {
  const audit = { created_by: 'test', last_updated_by: 'test' };
  await db.insert(apps).values({
    app_id: 'app_watchdog_gmail',
    app_name: 'watchdog_gmail',
    app_key: 'watchdog_gmail',
    app_display_name: 'Gmail',
    ...audit,
  });
  await db.insert(nodes).values({
    node_id: 'node_watchdog_gmail_new_message',
    app_id: 'app_watchdog_gmail',
    app_key: 'watchdog_gmail',
    node_name: 'new_message',
    node_key: 'gmail-new_message-1',
    node_display_name: 'New Gmail Message Received Trigger',
    node_kind: 'trigger',
    input_schema: { type: 'object', properties: {} },
    runtime_handler: 'composio.trigger.GMAIL_NEW_GMAIL_MESSAGE',
    ...audit,
  });
}

async function seed_watcher(options: {
  trigger_name: string;
  last_run_time: Date | null;
  wire?: { provisioning_key: string; connection_id: string };
}) {
  const trigger = await create_trigger(db, {
    workspace_id,
    agent_id,
    trigger_name: options.trigger_name,
    trigger_type: 'app_event',
    automation_id: 'atm_billing',
    node_id: 'node_watchdog_gmail_new_message',
    trigger_config: {
      starts_job_handler: 'run_automation',
      ...(options.wire
        ? { provisioned_by: 'composio' as const, provisioning_key: options.wire.provisioning_key }
        : {}),
      event_source: {
        node_key: 'gmail-new_message-1',
        trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
        connection_id: options.wire?.connection_id ?? 'con_missing',
      },
    },
    actor_id: user_id,
  });
  await db
    .update(triggers)
    .set({ last_run_time: options.last_run_time, created_time: four_days_ago })
    .where(eq(triggers.trigger_id, trigger.trigger_id));
  return trigger;
}

async function seed_connection(connection_id: string) {
  await db.insert(connections).values({
    connection_id,
    workspace_id,
    app_id: 'gmail',
    connection_status: 'active',
    external_account_id: 'ca_gmail_1',
    created_by: user_id,
    last_updated_by: user_id,
  });
}

type WireReader = NonNullable<Parameters<typeof run_automation_watchdog_job>[0]['wire_reader']>;

function run_the_job(wire_reader: WireReader = async () => [], at: Date = now) {
  return run_automation_watchdog_job({
    db,
    workspace_id,
    events: [fired_event],
    event_jobs: [],
    now: at,
    wire_reader,
  });
}

describe('run_automation_watchdog_job', () => {
  it('files one daily-summary notification for a silent watcher, and none for a busy one', async () => {
    const silent = await seed_watcher({ trigger_name: 'New mail', last_run_time: four_days_ago });
    await seed_watcher({ trigger_name: 'New calendar event', last_run_time: now });

    const result = await run_the_job();

    expect(result.result_data).toMatchObject({
      ran: true,
      triggers_checked: 2,
      complaints: [
        { trigger_id: silent.trigger_id, kind: 'silent', outcome: 'add_to_daily_summary' },
      ],
    });
    const written = await read_notifications();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ outcome: 'add_to_daily_summary', is_open: true });
    expect(deliver_to_person).not.toHaveBeenCalled();
    expect(written[0]?.notification).toMatchObject({
      urgency: 'fyi',
      automation_id: 'atm_billing',
    });
    expect(written[0]?.notification.title).toBe(
      'Billing questions: nothing has come in yet from Gmail',
    );
    expect(written[0]?.notification.body).toContain('4 days');
  });

  it('names the app by its catalog display name, not by the node key', async () => {
    await db
      .update(apps)
      .set({ app_display_name: 'Google Mail' })
      .where(eq(apps.app_id, 'app_watchdog_gmail'));
    await seed_watcher({ trigger_name: 'New mail', last_run_time: four_days_ago });

    await run_the_job();

    const [written] = await read_notifications();
    expect(written?.notification.title).toBe(
      'Billing questions: nothing has come in yet from Google Mail',
    );
  });

  it('complains about the same silent watcher once a day, not once every half hour', async () => {
    await seed_watcher({ trigger_name: 'New mail', last_run_time: four_days_ago });

    await run_the_job();
    const second_sweep = await run_the_job();

    expect(second_sweep.result_data).toMatchObject({
      complaints: [{ kind: 'silent', outcome: 'drop_with_reason' }],
    });
    expect(await read_notifications()).toHaveLength(1);
  });

  it('flags a wire the provider no longer has, and marks the trigger in error', async () => {
    await seed_connection('con_gmail');
    const wired = await seed_watcher({
      trigger_name: 'New mail',
      last_run_time: new Date('2026-09-15T08:00:00Z'),
      wire: { provisioning_key: 'ti_gone', connection_id: 'con_gmail' },
    });

    const first_tick = await run_the_job(async () => []);
    expect(first_tick.result_data).toMatchObject({ complaints: [] });
    const after_first = await db.query.triggers.findFirst({
      where: eq(triggers.trigger_id, wired.trigger_id),
    });
    expect(after_first?.trigger_status).toBe('enabled');

    const result = await run_the_job(async () => []);

    expect(result.result_data).toMatchObject({
      complaints: [{ trigger_id: wired.trigger_id, kind: 'dead_wire', outcome: 'notify_now' }],
    });
    const row = await db.query.triggers.findFirst({
      where: eq(triggers.trigger_id, wired.trigger_id),
    });
    expect(row?.trigger_status).toBe('error');
    expect(row?.trigger_config.provisioning_error).toBe(
      'The subscription no longer exists at the provider.',
    );
    const [notification] = await read_notifications();
    expect(notification?.notification.title).toBe(
      'Billing questions: Gmail is no longer connected',
    );
    expect(notification?.notification.body).toContain('Reconnect the app');
  });

  it('flags an enabled ear whose wire never went up', async () => {
    await seed_connection('con_gmail');
    const unwired = await seed_watcher({
      trigger_name: 'New mail',
      last_run_time: new Date('2026-09-15T08:00:00Z'),
      wire: { provisioning_key: 'ti_never', connection_id: 'con_gmail' },
    });
    const { provisioning_key: _key, ...config } = unwired.trigger_config;
    const set_last_updated = (at: Date) =>
      db
        .update(triggers)
        .set({ trigger_config: config, last_updated_time: at })
        .where(eq(triggers.trigger_id, unwired.trigger_id));

    await set_last_updated(new Date('2026-09-15T08:55:00Z'));
    await run_the_job();
    expect((await run_the_job()).result_data).toMatchObject({ complaints: [] });

    await set_last_updated(new Date('2026-09-15T08:40:00Z'));
    await run_the_job();
    const result = await run_the_job();

    expect(result.result_data).toMatchObject({
      complaints: [{ trigger_id: unwired.trigger_id, kind: 'dead_wire' }],
    });
    const row = await db.query.triggers.findFirst({
      where: eq(triggers.trigger_id, unwired.trigger_id),
    });
    expect(row?.trigger_status).toBe('error');
    expect(row?.trigger_config.provisioning_error).toBe(
      'The subscription was never set up at the provider.',
    );
  });

  it('leaves a live wire alone', async () => {
    await seed_connection('con_gmail');
    await seed_watcher({
      trigger_name: 'New mail',
      last_run_time: new Date('2026-09-15T08:00:00Z'),
      wire: { provisioning_key: 'ti_live', connection_id: 'con_gmail' },
    });

    const result = await run_the_job(async () => [
      {
        id: 'ti_live',
        connected_account_id: 'ca_gmail_1',
        trigger_name: 'gmail',
        trigger_config: {},
        disabled_at: null,
      },
    ]);

    expect(result.result_data).toMatchObject({ complaints: [] });
    expect(await read_notifications()).toHaveLength(0);
  });

  it('tells the person before it flips the row: a failed flip still leaves the notification written', async () => {
    await seed_connection('con_gmail');
    const wired = await seed_watcher({
      trigger_name: 'New mail',
      last_run_time: new Date('2026-09-15T08:00:00Z'),
      wire: { provisioning_key: 'ti_gone', connection_id: 'con_gmail' },
    });
    await run_the_job(async () => []);
    record_dead_wire.mockRejectedValue(new Error('the row could not be written'));

    await expect(run_the_job(async () => [])).rejects.toThrow('the row could not be written');

    const [notification] = await read_notifications();
    expect(notification?.notification.title).toBe(
      'Billing questions: Gmail is no longer connected',
    );
    const row = await db.query.triggers.findFirst({
      where: eq(triggers.trigger_id, wired.trigger_id),
    });
    expect(row?.trigger_status).toBe('enabled');
  });

  it('reports a trigger already in error again the next day', async () => {
    await seed_connection('con_gmail');
    await seed_watcher({
      trigger_name: 'New mail',
      last_run_time: new Date('2026-09-15T08:00:00Z'),
      wire: { provisioning_key: 'ti_gone', connection_id: 'con_gmail' },
    });

    await run_the_job(async () => []);
    await run_the_job(async () => []);
    const same_day = await run_the_job(async () => []);
    const next_day = await run_the_job(async () => [], new Date('2026-09-16T09:00:00Z'));

    expect(same_day.result_data).toMatchObject({
      triggers_checked: 1,
      complaints: [{ kind: 'dead_wire', outcome: 'drop_with_reason' }],
    });
    expect(next_day.result_data).toMatchObject({
      triggers_checked: 1,
      complaints: [{ kind: 'dead_wire', outcome: 'notify_now' }],
    });
    expect(await read_notifications()).toHaveLength(2);
  });

  it('asks the provider once for two watchers on the same connected account', async () => {
    await seed_connection('con_gmail');
    await seed_watcher({
      trigger_name: 'New mail',
      last_run_time: new Date('2026-09-15T08:00:00Z'),
      wire: { provisioning_key: 'ti_live', connection_id: 'con_gmail' },
    });
    await seed_watcher({
      trigger_name: 'New label',
      last_run_time: new Date('2026-09-15T08:00:00Z'),
      wire: { provisioning_key: 'ti_gone', connection_id: 'con_gmail' },
    });
    const wire_reader = vi.fn<WireReader>(async () => [
      {
        id: 'ti_live',
        connected_account_id: 'ca_gmail_1',
        trigger_name: 'gmail',
        trigger_config: {},
        disabled_at: null,
      },
    ]);

    await run_the_job(wire_reader);
    expect(wire_reader).toHaveBeenCalledTimes(1);
    expect(wire_reader).toHaveBeenCalledWith({ connected_account_id: 'ca_gmail_1' });

    const result = await run_the_job(wire_reader);
    expect(result.result_data).toMatchObject({ complaints: [{ kind: 'dead_wire' }] });
  });

  it('reads every page of the provider before calling a wire missing', async () => {
    await seed_connection('con_gmail');
    await seed_watcher({
      trigger_name: 'New mail',
      last_run_time: new Date('2026-09-15T08:00:00Z'),
      wire: { provisioning_key: 'ti_page_two', connection_id: 'con_gmail' },
    });
    const instance = (id: string) => ({
      id,
      connected_account_id: 'ca_gmail_1',
      trigger_name: 'GMAIL_NEW_GMAIL_MESSAGE',
      trigger_config: {},
      disabled_at: null,
    });
    const composio_fetch: typeof fetch = async (request) => {
      const on_page_two = new URL(String(request)).searchParams.get('cursor') === 'page_2';
      const body = on_page_two
        ? { items: [instance('ti_page_two')], next_cursor: null }
        : { items: [instance('ti_other')], next_cursor: 'page_2' };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const client = create_composio_client({ api_key: 'ck_test', fetch: composio_fetch });
    const wire_reader: WireReader = (input) =>
      list_composio_trigger_instances({ ...input, client });

    await run_the_job(wire_reader);
    const result = await run_the_job(wire_reader);

    expect(result.result_data).toMatchObject({ complaints: [] });
    expect(await read_notifications()).toHaveLength(0);
  });
});

async function read_notifications() {
  const page = await list_notifications_page(db, { workspace_id, page: 1, page_size: 100 });
  return page.items;
}
