import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { apps, automations, events, nodes, sessions, workspaces } from '@coworker/core/db/schema';
import type {
  AutomationConditions,
  AutomationJudge,
  AutomationStatus,
} from '@coworker/core/db/schema/automation_contracts';
import type { TriggerRule } from '@coworker/core/db/schema/json_column_types';
import type { StartAgentRunInput } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Two real boundaries are mocked and nothing else: the model (the judge) and the agent-run
// launch. The automation row, the trigger, the subject's session, the event and the job result are all
// read from a real database, because which of those says no IS this handler.

const start_agent_run = vi.fn(async (_db: Database, _input: StartAgentRunInput) => ({
  run_id: 'run_test',
  run_status: 'completed',
}));
vi.mock('@runtime-platform/orchestrator/runtime_orchestrator', () => ({ start_agent_run }));

const judge_answer = vi.fn(() => ({
  kind: 'Inquiry',
  confidence: 0.94,
  reason: 'asks about fees',
}));
const generate_object = vi.fn(async (input: { parse?: (value: unknown) => unknown }) => ({
  object: input.parse ? input.parse(judge_answer()) : judge_answer(),
}));
vi.mock('@agent-core/llm_gateway', () => ({ create_llm_gateway: () => ({ generate_object }) }));

const { run_automation_job } = await import('@runtime-platform/events/run_automation_job');
const { find_automation_fire_keys, automation_session_key } = await import(
  '@runtime-platform/automations/automation_subject'
);

type Db = Awaited<ReturnType<typeof create_test_database>>;

const delivery = {
  provider: 'composio',
  trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
  received_time: '2026-09-15T09:04:12Z',
  data: { id: 'msg_1', thread_id: '17bb03', sender: 'sam@example.com', subject: 'Invoice 1042?' },
};

const notion_node_key = 'composio_notion-page_created-1';

const run_policy = {
  subject_from: 'thread_id',
  when_a_run_is_already_going: 'wait_for_it_to_finish',
} as const;

async function seed_automation(
  db: Db,
  options: {
    conditions?: AutomationConditions;
    judge?: AutomationJudge;
    automation_status?: AutomationStatus;
    data?: Record<string, unknown>;
    ear_rules?: TriggerRule[];
  } = {},
) {
  const bootstrap = await bootstrap_default_workspace(db);
  const [automation] = await db
    .insert(automations)
    .values({
      automation_id: 'atm_1',
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      automation_name: 'Billing questions',
      automation_status: options.automation_status ?? 'enabled',
      instruction: 'Draft a reply and show it to me.',
      instruction_version: 3,
      uses_tools: { apps: ['gmail'] },
      run_policy,
      conditions: options.conditions ?? [],
      judge: options.judge ?? null,
      created_via: 'user',
      created_by: bootstrap.user_id,
      last_updated_by: bootstrap.user_id,
    })
    .returning();
  if (!automation) throw new Error('failed to seed the automation');

  const trigger = await create_trigger(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    trigger_name: 'New mail',
    trigger_type: 'app_event',
    trigger_config: {
      starts_job_handler: 'run_automation',
      provisioned_by: 'composio',
      ...(options.ear_rules ? { rules: options.ear_rules } : {}),
    },
    automation_id: automation.automation_id,
    actor_id: bootstrap.user_id,
  });

  const queue_key = automation_session_key(automation.automation_id, '17bb03');
  const [event] = await db
    .insert(events)
    .values({
      event_id: 'evt_delivery',
      workspace_id: bootstrap.workspace_id,
      source: 'trigger',
      source_event_id: `${trigger.trigger_id}:msg_1`,
      event_type: 'trigger.fired',
      queue_key,
      actor_key: 'system:trigger',
      event_body: {
        trigger_id: trigger.trigger_id,
        delivery: { ...delivery, data: { ...delivery.data, ...(options.data ?? {}) } },
      },
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    })
    .returning();
  if (!event) throw new Error('failed to seed the delivery event');
  return { bootstrap, automation, trigger, event, queue_key };
}

function run_the_job(
  db: Db,
  workspace_id: string,
  seeded: { event: typeof events.$inferSelect; queue_key: string },
) {
  return run_automation_job({
    db,
    workspace_id,
    queue_key: seeded.queue_key,
    events: [seeded.event],
  });
}

describe('run_automation_job', () => {
  beforeEach(() => {
    start_agent_run.mockClear();
    generate_object.mockClear();
    judge_answer.mockReturnValue({ kind: 'Inquiry', confidence: 0.94, reason: 'asks about fees' });
  });

  it('runs the subject with the automation, its version and the notification rail stamped on the run', async () => {
    const db = await create_test_database();
    const seeded = await seed_automation(db, {
      judge: { question: 'Is this a customer asking about a refund?' },
    });

    const result = await run_the_job(db, seeded.bootstrap.workspace_id, seeded);

    expect(result.job_status).toBe('done');
    expect(result.result_data).toMatchObject({
      automation_id: 'atm_1',
      trigger_id: seeded.trigger.trigger_id,
      ran: true,
      subject_is_known: false,
      judge: { kind: 'inquiry', confidence: 0.94 },
    });

    const started = start_agent_run.mock.calls[0]?.[1];
    expect(started).toMatchObject({
      automation_id: 'atm_1',
      user_message_source_metadata: {
        automation_id: 'atm_1',
        instruction_version: 3,
        instruction: 'Draft a reply and show it to me.',
      },
    });
    const first_part = started?.user_content?.[0];
    if (!first_part || first_part.type !== 'text') throw new Error('the run started with no text');
    expect(first_part.text).toContain('Draft a reply and show it to me.');
    expect(first_part.text).toContain('notifications-write_notification-1');

    // The session is the SUBJECT's, not the trigger's: the next message on this thread finds it.
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.external_thread_key, seeded.queue_key),
    });
    expect(session?.session_id).toBe((result.result_data as { session_id: string }).session_id);
  });

  it('never judges a subject it already works again', async () => {
    const db = await create_test_database();
    const seeded = await seed_automation(db, {
      conditions: [{ field: 'sender', operation: 'does_not_contain_any_of', values: ['sam'] }],
      judge: { question: 'Is this a customer asking about a refund?' },
    });
    // The first message already opened this thread's session.
    await db.insert(sessions).values({
      session_id: 'ses_known',
      workspace_id: seeded.bootstrap.workspace_id,
      agent_id: seeded.bootstrap.agent_id,
      session_source: 'trigger',
      source_type: 'trigger',
      external_thread_key: seeded.queue_key,
      session_title: 'Billing questions',
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    });

    const result = await run_the_job(db, seeded.bootstrap.workspace_id, seeded);

    // The rule above would have dropped this fire on an unknown subject; a known one skips both.
    expect(result.result_data).toMatchObject({ ran: true, subject_is_known: true });
    expect(generate_object).not.toHaveBeenCalled();
    expect(start_agent_run.mock.calls[0]?.[1].session_id).toBe('ses_known');
  });

  it('stops at the rules, before spending anything on a model', async () => {
    const db = await create_test_database();
    const seeded = await seed_automation(db, {
      conditions: [{ field: 'sender', operation: 'does_not_contain_any_of', values: ['sam'] }],
      judge: { question: 'Is this a customer asking about a refund?' },
    });

    const result = await run_the_job(db, seeded.bootstrap.workspace_id, seeded);

    expect(result.result_data).toMatchObject({ ran: false, skipped: { stage: 'rule' } });
    expect(generate_object).not.toHaveBeenCalled();
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('records the verdict even when the judge is too unsure to open a subject', async () => {
    const db = await create_test_database();
    const seeded = await seed_automation(db, {
      judge: { question: 'Is this a customer asking about a refund?' },
    });
    judge_answer.mockReturnValue({ kind: 'newsletter', confidence: 0.2, reason: 'a mailing list' });

    const result = await run_the_job(db, seeded.bootstrap.workspace_id, seeded);

    expect(result.result_data).toMatchObject({
      ran: false,
      // The bar it was held to rides along, so the fire can say "0.2 of the 0.8 it needed".
      judge: { kind: 'newsletter', confidence: 0.2, threshold: 0.8 },
      skipped: { stage: 'judge', reason: 'a mailing list' },
    });
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('hands the thread back when the mailbox itself sent the message, and stays out after', async () => {
    const db = await create_test_database();
    // Gmail's own label on the message: the account sent this, so the person has the thread.
    const seeded = await seed_automation(db, { data: { label_ids: ['SENT'] } });
    await seed_known_session(db, seeded);

    const result = await run_the_job(db, seeded.bootstrap.workspace_id, seeded);

    expect(result.result_data).toMatchObject({ ran: false, skipped: { stage: 'human' } });
    expect(start_agent_run).not.toHaveBeenCalled();
    expect((await read_subject_state(db)).human_took_over_time).toBeTruthy();

    // A later message from the customer stays out too: the person has the thread now. It is
    // recorded rather than answered, so the scout can raise it as an open loop.
    const customer = await seed_automation_fire(db, seeded, { id: 'msg_2' });
    const second = await run_automation_job({
      db,
      workspace_id: seeded.bootstrap.workspace_id,
      queue_key: seeded.queue_key,
      events: [customer],
    });
    expect(second.result_data).toMatchObject({ ran: false, skipped: { stage: 'human' } });
    const state = await read_subject_state(db);
    expect(state.last_customer_message_time).toBeTruthy();
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('runs a known thread normally when a stranger types a member address into From', async () => {
    const db = await create_test_database();
    const bootstrap_email = 'member@example.com';
    const seeded = await seed_automation(db, {
      data: { sender: `Dana Example <${bootstrap_email}>`, from: bootstrap_email },
    });
    await seed_known_session(db, seeded);
    await set_member_email(db, seeded.bootstrap.user_id, bootstrap_email);

    const result = await run_the_job(db, seeded.bootstrap.workspace_id, seeded);

    // An unauthenticated From proves nothing: the thread is not handed over and is not silenced.
    expect(result.result_data).toMatchObject({ ran: true, subject_is_known: true });
    expect(start_agent_run).toHaveBeenCalled();
    expect((await read_subject_state(db)).human_took_over_time).toBeUndefined();
  });

  it('keys a fire on the subject, so a reply queues behind the run already working that thread', async () => {
    const db = await create_test_database();
    const seeded = await seed_automation(db);
    const trigger = await get_trigger_by_id(db, seeded.trigger.trigger_id);
    if (!trigger) throw new Error('the trigger vanished');

    const keys = await find_automation_fire_keys(db, trigger, {
      occurrence_key: 'msg_2',
      delivery: { ...delivery, data: { ...delivery.data, id: 'msg_2' } },
    });

    // Second message, same thread: same ordering key as the first, so the engine serializes them.
    expect(keys?.queue_key).toBe(seeded.queue_key);
    expect(keys?.session_key).toBe(seeded.queue_key);
  });

  // The conditions of the ear itself are checked for every provider, not only the native ears.
  it('turns a fire away on the ear own conditions, before the judge', async () => {
    const db = await create_test_database();
    const seeded = await seed_automation(db, {
      ear_rules: [{ field: 'a_field_no_event_carries', operation: 'is_present' }],
      judge: { question: 'Is this a customer asking about a refund?' },
    });

    const result = await run_the_job(db, seeded.bootstrap.workspace_id, seeded);

    expect(result.result_data).toMatchObject({
      ran: false,
      skipped: { stage: 'ear_rule' },
      subject_source: 'automation',
    });
    expect(generate_object).not.toHaveBeenCalled();
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  // The second event on the same Notion page lands in the session of the first one. Nothing about
  // Notion is in the code: the node row carries `page_id`.
  it('continues the conversation for a provider the code never names', async () => {
    const db = await create_test_database();
    const seeded = await seed_notion_automation(db);
    const workspace_id = seeded.bootstrap.workspace_id;

    const first = await fire_notion_page(db, seeded, { event_id: 'del_1' });
    const second = await fire_notion_page(db, seeded, { event_id: 'del_2' });

    expect(first.result_data).toMatchObject({ ran: true, subject_source: 'node' });
    expect(second.result_data).toMatchObject({ ran: true, subject_is_known: true });
    expect((first.result_data as { session_id: string }).session_id).toBe(
      (second.result_data as { session_id: string }).session_id,
    );
  });

  it('skips a fire whose automation was deleted or paused, with the reason', async () => {
    const db = await create_test_database();
    const seeded = await seed_automation(db, { automation_status: 'paused' });
    const paused = await run_the_job(db, seeded.bootstrap.workspace_id, seeded);
    expect(paused.result_data).toMatchObject({ ran: false, code: 'automation_not_enabled' });

    await db.delete(automations).where(eq(automations.automation_id, 'atm_1'));
    const deleted = await run_the_job(db, seeded.bootstrap.workspace_id, seeded);
    expect(deleted.result_data).toMatchObject({ ran: false, code: 'automation_deleted' });
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  // A listen ear exists so the event lands in `events` where the scout can see it. Starting a run
  // on it would charge a workspace for hearing its own mail arrive.
  it('starts nothing, judges nothing and sends nothing to triage for mail the workspace itself sent', async () => {
    const own_address = `own-mailbox@${env.INBOUND_EMAIL_DOMAIN}`;
    const db = await create_test_database();
    const seeded = await seed_automation(db, {
      data: { sender: `Workspace agent <${own_address}>` },
    });
    await db
      .update(workspaces)
      .set({ inbound_email_username: 'own-mailbox' })
      .where(eq(workspaces.workspace_id, seeded.bootstrap.workspace_id));

    const result = await run_the_job(db, seeded.bootstrap.workspace_id, seeded);

    expect(env.INBOUND_EMAIL_DOMAIN).toBeTruthy();
    expect(result.result_data).toMatchObject({ ran: false, skipped: { stage: 'own_mail' } });
    expect(start_agent_run).not.toHaveBeenCalled();
    expect(generate_object).not.toHaveBeenCalled();
    const triaged = await db.query.events.findMany({
      where: eq(events.event_type, 'signal.triage'),
    });
    expect(triaged).toEqual([]);
  });

  it('records a listen fire and starts nothing', async () => {
    const db = await create_test_database();
    const seeded = await seed_automation(db);
    await db
      .update(automations)
      .set({ run_policy: { ...run_policy, listen: true } })
      .where(eq(automations.automation_id, 'atm_1'));

    const result = await run_the_job(db, seeded.bootstrap.workspace_id, seeded);

    expect(result.job_status).toBe('done');
    expect(result.result_data).toMatchObject({
      automation_id: 'atm_1',
      ran: false,
      skipped: { stage: 'listen' },
    });
    expect(start_agent_run).not.toHaveBeenCalled();
    // The fire itself is still on the record, which is the only thing the ear was for.
    const heard = await db.query.events.findFirst({
      where: eq(events.event_id, seeded.event.event_id),
    });
    expect(heard?.event_body).toMatchObject({
      delivery: { trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE' },
    });
  });
});

// A Notion page ear: the app, the node the catalog sync wrote `subject_field` on, the automation that
// names no subject field of its own, and its trigger.
async function seed_notion_automation(db: Db) {
  const bootstrap = await bootstrap_default_workspace(db);
  const audit = { created_by: 'test', last_updated_by: 'test' };
  await db
    .insert(apps)
    .values({
      app_id: 'app_notion',
      app_name: 'composio_notion',
      app_key: 'composio_notion',
      app_display_name: 'Notion',
      ...audit,
    })
    .onConflictDoNothing();
  await db.insert(nodes).values({
    node_id: 'nod_notion_page',
    app_id: 'app_notion',
    app_key: 'composio_notion',
    node_key: notion_node_key,
    node_name: 'page_created',
    node_display_name: 'Page created',
    node_kind: 'trigger',
    input_schema: { type: 'object', properties: {} },
    runtime_handler: 'composio.trigger.NOTION_PAGE_CREATED',
    node_runtime: 'connected_app',
    node_config: {
      composio: { toolkit_slug: 'notion', trigger_slug: 'NOTION_PAGE_CREATED' },
      subject_field: 'page_id',
    },
    ...audit,
  });
  const [automation] = await db
    .insert(automations)
    .values({
      automation_id: 'atm_notion',
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      automation_name: 'Page changes',
      automation_status: 'enabled',
      instruction: 'Summarize the page.',
      instruction_version: 1,
      uses_tools: { apps: ['notion'] },
      run_policy: { subject_from: null, when_a_run_is_already_going: 'wait_for_it_to_finish' },
      conditions: [],
      judge: null,
      created_via: 'user',
      created_by: bootstrap.user_id,
      last_updated_by: bootstrap.user_id,
    })
    .returning();
  if (!automation) throw new Error('failed to seed the notion automation');
  const trigger = await create_trigger(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    trigger_name: 'Notion page created',
    trigger_type: 'app_event',
    trigger_config: {
      starts_job_handler: 'run_automation',
      provisioned_by: 'composio',
      event_source: { node_key: notion_node_key, connection_id: 'conn_notion' },
    },
    automation_id: automation.automation_id,
    actor_id: bootstrap.user_id,
  });
  return { bootstrap, automation, trigger };
}

// One delivery, keyed the way the ingress keys it, then run as the queued job would run it.
async function fire_notion_page(
  db: Db,
  seeded: Awaited<ReturnType<typeof seed_notion_automation>>,
  delivery_id: { event_id: string },
) {
  const trigger = await get_trigger_by_id(db, seeded.trigger.trigger_id);
  if (!trigger) throw new Error('the trigger vanished');
  const notion_delivery = {
    provider: 'composio',
    trigger_slug: 'NOTION_PAGE_CREATED',
    received_time: '2026-09-16T09:00:00Z',
    data: { event_id: delivery_id.event_id, page_id: 'pg_7', workspace_name: 'Acme' },
  };
  const keys = await find_automation_fire_keys(db, trigger, {
    occurrence_key: delivery_id.event_id,
    delivery: notion_delivery,
  });
  if (!keys) throw new Error('the fire had no keys');
  const [event] = await db
    .insert(events)
    .values({
      event_id: `evt_${delivery_id.event_id}`,
      workspace_id: seeded.bootstrap.workspace_id,
      source: 'trigger',
      source_event_id: `${trigger.trigger_id}:${delivery_id.event_id}`,
      event_type: 'trigger.fired',
      queue_key: keys.queue_key,
      actor_key: 'system:trigger',
      event_body: { trigger_id: trigger.trigger_id, delivery: notion_delivery },
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    })
    .returning();
  if (!event) throw new Error('failed to seed the notion delivery event');
  return run_automation_job({
    db,
    workspace_id: seeded.bootstrap.workspace_id,
    queue_key: keys.queue_key,
    events: [event],
  });
}

async function seed_known_session(db: Db, seeded: Awaited<ReturnType<typeof seed_automation>>) {
  await db.insert(sessions).values({
    session_id: 'ses_known',
    workspace_id: seeded.bootstrap.workspace_id,
    agent_id: seeded.bootstrap.agent_id,
    session_source: 'trigger',
    source_type: 'trigger',
    external_thread_key: seeded.queue_key,
    session_title: 'Billing questions',
    created_by: 'system:trigger',
    last_updated_by: 'system:trigger',
  });
}

// A second fire on the same thread, from the customer: no SENT label, no verified-member flag.
async function seed_automation_fire(
  db: Db,
  seeded: Awaited<ReturnType<typeof seed_automation>>,
  message: { id: string },
) {
  const [event] = await db
    .insert(events)
    .values({
      event_id: `evt_${message.id}`,
      workspace_id: seeded.bootstrap.workspace_id,
      source: 'trigger',
      source_event_id: `${seeded.trigger.trigger_id}:${message.id}`,
      event_type: 'trigger.fired',
      queue_key: seeded.queue_key,
      actor_key: 'system:trigger',
      event_body: {
        trigger_id: seeded.trigger.trigger_id,
        delivery: { ...delivery, data: { ...delivery.data, id: message.id } },
      },
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    })
    .returning();
  if (!event) throw new Error('failed to seed the second delivery event');
  return event;
}

async function read_subject_state(db: Db) {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.session_id, 'ses_known'),
  });
  const metadata = session?.session_metadata as {
    automation_subject?: { human_took_over_time?: string; last_customer_message_time?: string };
  };
  return metadata.automation_subject ?? {};
}

async function set_member_email(db: Db, user_id: string, email: string) {
  const { users } = await import('@coworker/core/db/schema');
  await db.update(users).set({ email }).where(eq(users.user_id, user_id));
}
